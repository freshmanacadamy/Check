// ==================== FIREBASE SETUP ====================
const privateKey = process.env.FIREBASE_PRIVATE_KEY;
const serviceAccount = {
  type: "service_account",
  project_id: process.env.FIREBASE_PROJECT_ID,
  private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
  private_key: privateKey ? privateKey.replace(/\\n/g, '\n') : undefined,
  client_email: process.env.FIREBASE_CLIENT_EMAIL,
  client_id: process.env.FIREBASE_CLIENT_ID,
  auth_uri: "https://accounts.google.com/o/oauth2/auth",
  token_uri: "https://oauth2.googleapis.com/token",
  auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs"
};

// Validate required environment variables
const requiredEnvVars = ['FIREBASE_PRIVATE_KEY', 'FIREBASE_PROJECT_ID', 'FIREBASE_CLIENT_EMAIL', 'TELEGRAM_BOT_TOKEN'];
const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingVars.length > 0) {
  console.error('❌ Missing required environment variables:', missingVars);
  // Don't crash, just log the error
}

if (!admin.apps.length && missingVars.length === 0) {
  try {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    console.log('✅ Firebase initialized successfully');
  } catch (error) {
    console.error('❌ Firebase initialization failed:', error);
  }
}
// Initialize immediately
initializeCounter();

// ==================== SESSION MIDDLEWARE ====================
bot.use(session({ 
  defaultSession: () => ({}) 
}));

// ==================== DATABASE MANAGER ====================
class DatabaseManager {
  // User management
  async getUser(userId) {
    try {
      const userDoc = await db.collection('users').doc(userId.toString()).get();
      return userDoc.exists ? userDoc.data() : null;
    } catch (error) {
      console.error('Error getting user:', error);
      return null;
    }
  }

  async createUser(userData) {
    try {
      await db.collection('users').doc(userData.userId.toString()).set({
        userId: userData.userId,
        username: userData.username,
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
      return userData;
    } catch (error) {
      console.error('Error creating user:', error);
      throw error;
    }
  }

  async updateUser(userId, updates) {
    try {
      updates.lastSeen = new Date().toISOString();
      await db.collection('users').doc(userId.toString()).update(updates);
    } catch (error) {
      console.error('Error updating user:', error);
      throw error;
    }
  }

  // Confession management
  async createConfession(confessionData) {
    try {
      await db.collection('confessions').doc(confessionData.confessionId).set(confessionData);
      return confessionData;
    } catch (error) {
      console.error('Error creating confession:', error);
      throw error;
    }
  }

  async updateConfession(confessionId, updates) {
    try {
      await db.collection('confessions').doc(confessionId).update(updates);
    } catch (error) {
      console.error('Error updating confession:', error);
      throw error;
    }
  }

  async getConfession(confessionId) {
    try {
      const doc = await db.collection('confessions').doc(confessionId).get();
      return doc.exists ? doc.data() : null;
    } catch (error) {
      console.error('Error getting confession:', error);
      return null;
    }
  }

  // Comment management
  async createComment(commentData) {
    try {
      await db.collection('comments').doc(commentData.commentId).set(commentData);
      return commentData;
    } catch (error) {
      console.error('Error creating comment:', error);
      throw error;
    }
  }

  async getComments(confessionId) {
    try {
      const snapshot = await db.collection('comments')
        .where('confessionId', '==', confessionId)
        .orderBy('createdAt', 'asc')
        .get();
      return snapshot.docs.map(doc => doc.data());
    } catch (error) {
      console.error('Error getting comments:', error);
      return [];
    }
  }

  // Message management
  async createMessage(messageData) {
    try {
      await db.collection('private_messages').doc(messageData.messageId).set(messageData);
      return messageData;
    } catch (error) {
      console.error('Error creating message:', error);
      throw error;
    }
  }

  async getMessagesBetweenUsers(user1, user2) {
    try {
      const snapshot = await db.collection('private_messages')
        .where('participants', 'array-contains', user1)
        .get();
      
      return snapshot.docs
        .map(doc => doc.data())
        .filter(msg => msg.participants.includes(user2));
    } catch (error) {
      console.error('Error getting messages:', error);
      return [];
    }
  }
}

const dbManager = new DatabaseManager();


// ==================== START COMMAND & MAIN MENU ====================
bot.command('start', async (ctx) => {
  console.log(`🚀 Start command from user: ${ctx.from.id}`);
  
  try {
    const userId = ctx.from.id;
    
    // Create user if doesn't exist
    let user = await dbManager.getUser(userId);
    if (!user) {
      await dbManager.createUser({
        userId: userId,
        username: ctx.from.username || ctx.from.first_name
      });
      console.log(`✅ New user created: ${userId}`);
    } else {
      await dbManager.updateUser(userId, { lastSeen: new Date().toISOString() });
    }

    await showMainMenu(ctx);
    
  } catch (error) {
    console.error('❌ Start command error:', error);
    await ctx.reply('❌ Bot error. Please try again.');
  }
});

async function showMainMenu(ctx) {
  const welcomeText = `🤫 *Welcome to JU Confession Bot!*\n\n` +
    `Share your thoughts *anonymously* and connect with others.\n\n` +
    `*Your identity is completely hidden!*`;

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('✍️ Send Confession', 'send_confession')],
    [Markup.button.callback('📋 Browse Confessions', 'browse_confessions')],
    [Markup.button.callback('👤 My Profile', 'show_profile')],
    [Markup.button.callback('📌 Rules', 'show_rules'), Markup.button.callback('ℹ️ About', 'show_about')]
  ]);

  if (ctx.updateType === 'callback_query') {
    await ctx.editMessageText(welcomeText, { 
      parse_mode: 'Markdown',
      reply_markup: keyboard.reply_markup 
    });
  } else {
    await ctx.replyWithMarkdown(welcomeText, keyboard);
  }
}

// ==================== RULES BUTTON ====================
bot.action('show_rules', async (ctx) => {
  try {
    const rulesText = `📌 *Confession Rules*\n\n` +
      `✅ *Allowed:*\n` +
      `• Personal thoughts and feelings\n` +
      `• Crushes and relationships\n` +
      `• Academic struggles\n` +
      `• Friendly messages\n` +
      `• Positive confessions\n\n` +
      `❌ *Not Allowed:*\n` +
      `• Hate speech or bullying\n` +
      `• Personal attacks\n` +
      `• Spam or advertisements\n` +
      `• Illegal content\n` +
      `• Doxing or sharing private info\n\n` +
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
  } catch (error) {
    console.error('❌ Rules button error:', error);
    await ctx.answerCbQuery('❌ Error loading rules');
  }
});

// ==================== ABOUT BUTTON ====================
bot.action('show_about', async (ctx) => {
  try {
    const aboutText = `ℹ️ *About JU Confession Bot*\n\n` +
      `*Features:*\n` +
      `• 100% Anonymous - No one sees your identity\n` +
      `• Admin moderated - Safe content only\n` +
      `• Social features - Follow users, build reputation\n` +
      `• Private messaging - Connect anonymously\n` +
      `• Comment system - Discuss confessions\n` +
      `• Profile customization - Express yourself\n` +
      `• Free to use - No charges ever\n\n` +
      `*Privacy Guarantee:*\n` +
      `Your Telegram ID is stored only to prevent spam and notify you. It is *never* shown to other users.`;

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('✍️ Send Confession', 'send_confession')],
      [Markup.button.callback('🔙 Main Menu', 'main_menu')]
    ]);

    await ctx.editMessageText(aboutText, { 
      parse_mode: 'Markdown',
      reply_markup: keyboard.reply_markup 
    });
    await ctx.answerCbQuery();
  } catch (error) {
    console.error('❌ About button error:', error);
    await ctx.answerCbQuery('❌ Error loading about');
  }
});

// ==================== MAIN MENU BUTTON ====================
bot.action('main_menu', async (ctx) => {
  try {
    await showMainMenu(ctx);
    await ctx.answerCbQuery();
  } catch (error) {
    console.error('❌ Main menu error:', error);
    await ctx.answerCbQuery('❌ Error loading menu');
  }
});

// ==================== BROWSE CONFESSIONS BUTTON ====================
bot.action('browse_confessions', async (ctx) => {
  try {
    const confessionsText = `📋 *Browse Confessions*\n\n` +
      `View recent confessions from the community:`;

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('🔄 Latest Confessions', 'view_latest_confessions')],
      [Markup.button.callback('🔥 Trending', 'view_trending_confessions')],
      [Markup.button.callback('🔍 Search Hashtags', 'search_hashtags')],
      [Markup.button.callback('🔙 Main Menu', 'main_menu')]
    ]);

    await ctx.editMessageText(confessionsText, { 
      parse_mode: 'Markdown',
      reply_markup: keyboard.reply_markup 
    });
    await ctx.answerCbQuery();
  } catch (error) {
    console.error('❌ Browse confessions error:', error);
    await ctx.answerCbQuery('❌ Error loading confessions');
  }
});

// ==================== SEND CONFESSION BUTTON ====================
bot.action('send_confession', async (ctx) => {
  try {
    const userId = ctx.from.id;
    const now = Date.now();
    
    // Cooldown check
    const lastSubmit = userCooldown.get(userId);
    if (lastSubmit && (now - lastSubmit) < 60000) {
      const waitTime = Math.ceil((60000 - (now - lastSubmit)) / 1000);
      await ctx.answerCbQuery(`⏳ Please wait ${waitTime} seconds`);
      return;
    }

    await ctx.replyWithMarkdown(
      `✍️ *Send Your Confession*\n\n` +
      `Type your confession below (max 1000 characters):\n\n` +
      `💡 *Tip:* Add hashtags like:\n` +
      `#Relationship #CampusLife #MentalHealth\n` +
      `#StudyProblems #Friendship #Crush\n` +
      `#AdviceNeeded #Confused #Happy`
    );
    
    ctx.session.waitingForConfession = true;
    await ctx.answerCbQuery();
  } catch (error) {
    console.error('❌ Send confession error:', error);
    await ctx.answerCbQuery('❌ Error starting confession');
  }
});

// ==================== HANDLE CONFESSION SUBMISSION ====================
async function handleConfessionSubmission(ctx, text) {
  const userId = ctx.from.id;
  
  try {
    // Basic validation
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

    const confessionId = `confess_${userId}_${Date.now()}`;
    const now = Date.now();
    
    // Extract hashtags
    const hashtags = text.match(/#[\w]+/g) || [];
    
    // Save to Firebase
    await dbManager.createConfession({
      confessionId: confessionId,
      userId: userId,
      text: text.trim(),
      hashtags: hashtags,
      status: 'pending',
      commentCount: 0,
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
      [Markup.button.callback('📋 Browse Confessions', 'browse_confessions')],
      [Markup.button.callback('🔙 Main Menu', 'main_menu')]
    ]);

    await ctx.replyWithMarkdown(
      `✅ *Confession Submitted!*\n\n` +
      `Your confession is under review by admin.\n\n` +
      `📝 *Status:* Waiting for approval\n` +
      `⏰ *Note:* You'll get a notification when it's posted\n` +
      `💬 People will be able to comment on it`,
      keyboard
    );
    
  } catch (error) {
    console.error('❌ Confession submission error:', error);
    await ctx.reply('❌ Error submitting confession. Please try again.');
    ctx.session.waitingForConfession = false;
  }
}

// ==================== ADMIN NOTIFICATION ====================
async function notifyAdmins(confessionId, text, username) {
  const adminIds = process.env.ADMIN_IDS?.split(',') || [];
  
  const message = `🤫 *New Confession Submission*\n\n` +
    `👤 *From:* ${username || 'Anonymous'}\n` +
    `🆔 *User ID:* ${confessionId.split('_')[1]}\n` +
    `🆔 *Confession ID:* ${confessionId}\n\n` +
    `*Confession Text:*\n"${text}"\n\n` +
    `*Admin Actions:*`;

  const keyboard = Markup.inlineKeyboard([
    [
      Markup.button.callback('✅ Approve', `approve_${confessionId}`),
      Markup.button.callback('❌ Reject', `reject_${confessionId}`)
    ],
    [
      Markup.button.callback('📩 Message User', `message_user_${confessionId.split('_')[1]}`),
      Markup.button.callback('👀 View User', `view_user_${confessionId.split('_')[1]}`)
    ]
  ]);

  for (const adminId of adminIds) {
    try {
      await bot.telegram.sendMessage(adminId, message, {
        parse_mode: 'Markdown',
        reply_markup: keyboard.reply_markup
      });
      console.log(`✅ Notified admin: ${adminId}`);
    } catch (error) {
      console.error(`❌ Admin notify error ${adminId}:`, error);
    }
  }
       }

// ==================== ADMIN APPROVAL BUTTON ====================
bot.action(/approve_(.+)/, async (ctx) => {
  const confessionId = ctx.match[1];
  console.log(`✅ Admin approval for: ${confessionId}`);
  
  try {
    const confession = await dbManager.getConfession(confessionId);
    if (!confession) {
      await ctx.answerCbQuery('❌ Confession not found');
      return;
    }

    // Increment counter
    confessionCounter += 1;
    
    // Update confession
    await dbManager.updateConfession(confessionId, {
      status: 'approved',
      confessionNumber: confessionCounter,
      approvedAt: new Date().toISOString(),
      approvedBy: ctx.from.username || 'Admin'
    });

    // Post to channel with comment button
    await postToChannel(confession.text, confessionCounter, confession.hashtags, confessionId);

    // Notify user
    await notifyUser(confession.userId, confessionCounter, 'approved');

    // Update admin message (remove buttons)
    await ctx.editMessageText(
      `✅ *Confession #${confessionCounter} Approved!*\n\n` +
      `Confession has been posted to the channel.\n` +
      `User has been notified.`,
      { parse_mode: 'Markdown' }
    );
    
    await ctx.answerCbQuery('✅ Approved!');

  } catch (error) {
    console.error('❌ Approval error:', error);
    await ctx.answerCbQuery('❌ Approval failed');
  }
});

// ==================== ADMIN REJECTION BUTTON ====================
bot.action(/reject_(.+)/, async (ctx) => {
  const confessionId = ctx.match[1];
  console.log(`❌ Admin rejection for: ${confessionId}`);
  
  try {
    await ctx.editMessageText(
      `❌ *Rejecting Confession*\n\nPlease provide rejection reason:`,
      { parse_mode: 'Markdown' }
    );
    ctx.session.rejectingConfession = confessionId;
    await ctx.answerCbQuery();
  } catch (error) {
    console.error('❌ Rejection init error:', error);
    await ctx.answerCbQuery('❌ Error starting rejection');
  }
});

// ==================== HANDLE REJECTION REASON ====================
async function handleRejectionReason(ctx, reason) {
  const confessionId = ctx.session.rejectingConfession;
  
  try {
    const confession = await dbManager.getConfession(confessionId);
    if (confession) {
      await dbManager.updateConfession(confessionId, {
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
    console.error('❌ Rejection error:', error);
    await ctx.reply('❌ Rejection failed');
  }
  
  ctx.session.rejectingConfession = null;
}

// ==================== ADMIN VIEW USER BUTTON ====================
bot.action(/view_user_(.+)/, async (ctx) => {
  const userId = ctx.match[1];
  
  try {
    const user = await dbManager.getUser(userId);
    if (!user) {
      await ctx.answerCbQuery('❌ User not found');
      return;
    }

    // Get user's confessions count
    const confessionsSnapshot = await db.collection('confessions')
      .where('userId', '==', userId)
      .get();

    const userInfo = `👤 *User Profile (Admin View)*\n\n` +
      `🆔 *Telegram ID:* ${userId}\n` +
      `📛 *Username:* @${user.username || 'No username'}\n` +
      `🎭 *Nickname:* ${user.nickname}\n` +
      `✨ *Aura:* ${user.aura}\n` +
      `👥 *Followers:* ${user.followers.length} | *Following:* ${user.following.length}\n\n` +
      `📊 *Statistics:*\n` +
      `• Confessions: ${confessionsSnapshot.size}\n` +
      `• Joined: ${new Date(user.joinedAt).toLocaleDateString()}\n` +
      `• Last Seen: ${new Date(user.lastSeen).toLocaleString()}\n\n` +
      `📝 *Bio:* ${user.bio}`;

    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback('📩 Message User', `message_user_${userId}`),
        Markup.button.callback('🚫 Block User', `block_user_${userId}`)
      ],
      [
        Markup.button.callback('📊 User Analytics', `user_analytics_${userId}`),
        Markup.button.callback('🔙 Back', 'admin_dashboard')
      ]
    ]);

    await ctx.editMessageText(userInfo, { 
      parse_mode: 'Markdown',
      reply_markup: keyboard.reply_markup 
    });
    await ctx.answerCbQuery();
  } catch (error) {
    console.error('❌ View user error:', error);
    await ctx.answerCbQuery('❌ Error loading user');
  }
});

// ==================== ADMIN MESSAGE USER BUTTON ====================
bot.action(/message_user_(.+)/, async (ctx) => {
  const userId = ctx.match[1];
  
  try {
    const user = await dbManager.getUser(userId);
    if (!user) {
      await ctx.answerCbQuery('❌ User not found');
      return;
    }

    await ctx.editMessageText(
      `📩 *Messaging User*\n\n` +
      `User: ${user.nickname} (@${user.username || 'no_username'})\n` +
      `ID: ${userId}\n\n` +
      `Type your message below:`,
      { parse_mode: 'Markdown' }
    );
    ctx.session.messagingUser = userId;
    await ctx.answerCbQuery();
  } catch (error) {
    console.error('❌ Message user error:', error);
    await ctx.answerCbQuery('❌ Error starting message');
  }
});

// ==================== HANDLE ADMIN MESSAGE ====================
async function handleAdminMessage(ctx, text) {
  const userId = ctx.session.messagingUser;

  try {
    const user = await dbManager.getUser(userId);
    if (!user) {
      await ctx.reply('❌ User not found');
      ctx.session.messagingUser = null;
      return;
    }

    await bot.telegram.sendMessage(
      userId, 
      `📩 *Message from Admin*\n\n${text}\n\n💬 You can reply to this message.`,
      { parse_mode: 'Markdown' }
    );

    // Save message to database for monitoring
    const messageId = `admin_msg_${Date.now()}`;
    await dbManager.createMessage({
      messageId: messageId,
      fromUserId: ctx.from.id,
      toUserId: userId,
      text: text,
      isAdminMessage: true,
      createdAt: new Date().toISOString()
    });

    await ctx.reply(`✅ Message sent to ${user.nickname} (@${user.username || 'no_username'})`);
  } catch (error) {
    await ctx.reply(`❌ Failed to send message. User may have blocked the bot.`);
  }
  
  ctx.session.messagingUser = null;
}

// ==================== CHANNEL POSTING ====================
async function postToChannel(text, number, hashtags = [], confessionId) {
  const channelId = process.env.CHANNEL_ID;
  
  const hashtagString = hashtags.length > 0 ? `\n\n${hashtags.join(' ')}` : '';
  const message = `#${number}\n\n${text}${hashtagString}`;

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback(`👁️‍🗨️ View/Add Comments (0)`, `confession_${confessionId}`)]
  ]);

  try {
    await bot.telegram.sendMessage(channelId, message, {
      reply_markup: keyboard.reply_markup
    });
    console.log(`✅ Posted confession #${number} to channel`);
  } catch (error) {
    console.error('❌ Channel post error:', error);
  }
}

// ==================== USER NOTIFICATION ====================
async function notifyUser(userId, number, status, reason = '') {
  try {
    let message = '';
    if (status === 'approved') {
      message = `🎉 *Your Confession #${number} was approved!*\n\n` +
        `It has been posted to the channel. People can now view and comment on it!\n\n` +
        `💬 *Engage with your confession:*\n` +
        `• People can comment anonymously\n` +
        `• You'll get notified of new comments\n` +
        `• Build your aura points\n\n` +
        `Thank you for sharing! 💖`;
    } else {
      message = `❌ *Confession Not Approved*\n\n` +
        `Your confession was not approved for the following reason:\n\n` +
        `📝 *Reason:* ${reason}\n\n` +
        `💡 *Tips for better confessions:*\n` +
        `• Be respectful and positive\n` +
        `• Avoid personal attacks\n` +
        `• Keep it anonymous and safe\n\n` +
        `You can submit a new confession following the guidelines.`;
    }

    await bot.telegram.sendMessage(userId, message, { parse_mode: 'Markdown' });
    console.log(`✅ Notified user ${userId} about ${status}`);
  } catch (error) {
    console.error('❌ User notify error:', error);
  }
}

// ==================== CONFESSION COMMENT BUTTON (FROM CHANNEL) ====================
bot.action(/confession_(.+)/, async (ctx) => {
  const confessionId = ctx.match[1];
  
  try {
    const confession = await dbManager.getConfession(confessionId);
    if (!confession) {
      await ctx.answerCbQuery('❌ Confession not found');
      return;
    }

    const comments = await dbManager.getComments(confessionId);
    
    const confessionText = `📖 *Confession #${confession.confessionNumber}*\n\n` +
      `${confession.text}\n\n` +
      `💬 *Comments:* ${comments.length}\n` +
      `🕒 Posted: ${new Date(confession.approvedAt).toLocaleDateString()}`;

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('💬 Add Comment', `add_comment_${confessionId}`)],
      [Markup.button.callback('📋 Browse Comments', `browse_comments_${confessionId}`)],
      [Markup.button.callback('💌 Send Private Message', `private_message_${confession.userId}`)],
      [Markup.button.callback('👤 View Profile', `view_profile_${confession.userId}`)],
      [Markup.button.callback('➡️ Next Confession', `next_confession_${confessionId}`)]
    ]);

    await ctx.editMessageText(confessionText, { 
      parse_mode: 'Markdown',
      reply_markup: keyboard.reply_markup 
    });
    await ctx.answerCbQuery();
  } catch (error) {
    console.error('❌ Confession view error:', error);
    await ctx.answerCbQuery('❌ Error loading confession');
  }
});

// ==================== ADD COMMENT BUTTON ====================
bot.action(/add_comment_(.+)/, async (ctx) => {
  const confessionId = ctx.match[1];
  
  try {
    const confession = await dbManager.getConfession(confessionId);
    if (!confession) {
      await ctx.answerCbQuery('❌ Confession not found');
      return;
    }

    await ctx.replyWithMarkdown(
      `💬 *Add Comment to Confession #${confession.confessionNumber}*\n\n` +
      `Confession: "${confession.text.substring(0, 100)}${confession.text.length > 100 ? '...' : ''}"\n\n` +
      `Please write your comment below:\n\n` +
      `🔒 *Note:* Your comment will be anonymous to other users.`
    );
    
    ctx.session.waitingForComment = true;
    ctx.session.commentConfessionId = confessionId;
    await ctx.answerCbQuery();
  } catch (error) {
    console.error('❌ Add comment error:', error);
    await ctx.answerCbQuery('❌ Error starting comment');
  }
});

// ==================== BROWSE COMMENTS BUTTON ====================
bot.action(/browse_comments_(.+)/, async (ctx) => {
  const confessionId = ctx.match[1];
  
  try {
    const confession = await dbManager.getConfession(confessionId);
    const comments = await dbManager.getComments(confessionId);
    
    if (comments.length === 0) {
      const noCommentsText = `📋 *Comments on Confession #${confession.confessionNumber}*\n\n` +
        `No comments yet. Be the first to comment!`;
      
      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('💬 Add First Comment', `add_comment_${confessionId}`)],
        [Markup.button.callback('🔙 Back to Confession', `confession_${confessionId}`)]
      ]);

      await ctx.editMessageText(noCommentsText, { 
        parse_mode: 'Markdown',
        reply_markup: keyboard.reply_markup 
      });
    } else {
      let commentsText = `📋 *Comments on Confession #${confession.confessionNumber}*\n\n`;
      
      // Show first 5 comments
      comments.slice(0, 5).forEach((comment, index) => {
        commentsText += `💬 ${comment.text}\n\n`;
      });

      if (comments.length > 5) {
        commentsText += `📄 Showing 5 of ${comments.length} comments\n\n`;
      }

      commentsText += `💬 *Total Comments:* ${comments.length}`;

      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('💬 Add Comment', `add_comment_${confessionId}`)],
        [Markup.button.callback('📄 View All Comments', `view_all_comments_${confessionId}`)],
        [Markup.button.callback('🔙 Back to Confession', `confession_${confessionId}`)]
      ]);

      await ctx.editMessageText(commentsText, { 
        parse_mode: 'Markdown',
        reply_markup: keyboard.reply_markup 
      });
    }
    await ctx.answerCbQuery();
  } catch (error) {
    console.error('❌ Browse comments error:', error);
    await ctx.answerCbQuery('❌ Error loading comments');
  }
});

// ==================== HANDLE COMMENT SUBMISSION ====================
async function handleCommentSubmission(ctx, text) {
  const userId = ctx.from.id;
  const confessionId = ctx.session.commentConfessionId;

  if (!confessionId) {
    await ctx.reply('❌ No confession selected for comment.');
    ctx.session.waitingForComment = false;
    return;
  }

  try {
    // Validate comment
    if (!text || text.trim().length < 2) {
      await ctx.reply('❌ Comment too short. Minimum 2 characters.');
      return;
    }

    if (text.length > 500) {
      await ctx.reply('❌ Comment too long. Maximum 500 characters.');
      return;
    }

    const commentId = `comment_${userId}_${Date.now()}`;
    const confession = await dbManager.getConfession(confessionId);
    
    // Save comment
    await dbManager.createComment({
      commentId: commentId,
      confessionId: confessionId,
      userId: userId,
      text: text.trim(),
      isAnonymous: true,
      createdAt: new Date().toISOString()
    });

    // Update comment count
    const comments = await dbManager.getComments(confessionId);
    await dbManager.updateConfession(confessionId, {
      commentCount: comments.length
    });

    // Update channel button with new count
    await updateChannelCommentCount(confessionId, comments.length);

    // Notify confession owner (if it's not the owner commenting)
    if (confession.userId !== userId) {
      await notifyCommentOwner(confession, text.trim(), comments.length);
    }

    // Clear session
    ctx.session.waitingForComment = false;
    ctx.session.commentConfessionId = null;

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('📋 Browse Comments', `browse_comments_${confessionId}`)],
      [Markup.button.callback('🔙 Back to Confession', `confession_${confessionId}`)]
    ]);

    await ctx.replyWithMarkdown(
      `✅ *Comment Added!*\n\n` +
      `Your comment has been added to Confession #${confession.confessionNumber}.\n\n` +
      `💬 Total comments: ${comments.length}`,
      keyboard
    );

  } catch (error) {
    console.error('❌ Comment submission error:', error);
    await ctx.reply('❌ Error submitting comment. Please try again.');
    ctx.session.waitingForComment = false;
    ctx.session.commentConfessionId = null;
  }
}

// ==================== UPDATE CHANNEL COMMENT COUNT ====================
async function updateChannelCommentCount(confessionId, count) {
  try {
    // This would require storing channel message IDs and editing the message
    // For now, we'll just log it
    console.log(`📊 Comment count updated for confession ${confessionId}: ${count} comments`);
    
    // In a full implementation, you would:
    // 1. Store channelMessageId when posting confession
    // 2. Use bot.telegram.editMessageReplyMarkup() to update the button
  } catch (error) {
    console.error('❌ Update comment count error:', error);
  }
}

// ==================== NOTIFY COMMENT OWNER ====================
async function notifyCommentOwner(confession, commentText, totalComments) {
  try {
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('💬 View Comments', `browse_comments_${confession.confessionId}`)]
    ]);

    await bot.telegram.sendMessage(
      confession.userId,
      `💬 *New Comment on Your Confession!*\n\n` +
      `Someone commented on your Confession #${confession.confessionNumber}:\n\n` +
      `💡 *Your Confession:*\n"${confession.text.substring(0, 100)}${confession.text.length > 100 ? '...' : ''}"\n\n` +
      `💬 *New Comment:*\n"${commentText}"\n\n` +
      `📊 Total comments: ${totalComments}`,
      { 
        parse_mode: 'Markdown',
        reply_markup: keyboard.reply_markup 
      }
    );
  } catch (error) {
    console.error('❌ Notify comment owner error:', error);
  }
}

// ==================== PRIVATE MESSAGE BUTTON ====================
bot.action(/private_message_(.+)/, async (ctx) => {
  const targetUserId = ctx.match[1];
  const currentUserId = ctx.from.id;
  
  // Can't message yourself
  if (targetUserId === currentUserId.toString()) {
    await ctx.answerCbQuery('❌ You cannot message yourself');
    return;
  }

  try {
    const targetUser = await dbManager.getUser(targetUserId);
    if (!targetUser) {
      await ctx.answerCbQuery('❌ User not found');
      return;
    }

    // Check if target user allows chats
    if (!targetUser.privacySettings.allowChats) {
      await ctx.answerCbQuery('❌ This user does not accept messages');
      return;
    }

    await ctx.replyWithMarkdown(
      `💌 *Send Private Message*\n\n` +
      `You're messaging: *${targetUser.nickname}* ${targetUser.profileEmoji !== 'None' ? targetUser.profileEmoji : ''}\n\n` +
      `✨ Aura: ${targetUser.aura}\n` +
      `📝 Bio: ${targetUser.bio}\n\n` +
      `Type your message below:\n\n` +
      `🔒 *Note:* Your identity will be hidden. This is completely anonymous.`
    );
    
    ctx.session.waitingForPrivateMessage = true;
    ctx.session.messageTargetUserId = targetUserId;
    await ctx.answerCbQuery();
  } catch (error) {
    console.error('❌ Private message error:', error);
    await ctx.answerCbQuery('❌ Error starting message');
  }
});

// ==================== HANDLE PRIVATE MESSAGE ====================
async function handlePrivateMessage(ctx, text) {
  const fromUserId = ctx.from.id;
  const toUserId = ctx.session.messageTargetUserId;

  if (!toUserId) {
    await ctx.reply('❌ No user selected for messaging.');
    ctx.session.waitingForPrivateMessage = false;
    return;
  }

  try {
    // Validate message
    if (!text || text.trim().length < 2) {
      await ctx.reply('❌ Message too short. Minimum 2 characters.');
      return;
    }

    if (text.length > 1000) {
      await ctx.reply('❌ Message too long. Maximum 1000 characters.');
      return;
    }

    const toUser = await dbManager.getUser(toUserId);
    if (!toUser) {
      await ctx.reply('❌ User not found.');
      ctx.session.waitingForPrivateMessage = false;
      return;
    }

    // Check if user allows chats
    if (!toUser.privacySettings.allowChats) {
      await ctx.reply('❌ This user does not accept messages.');
      ctx.session.waitingForPrivateMessage = false;
      return;
    }

    const messageId = `msg_${fromUserId}_${toUserId}_${Date.now()}`;
    
    // Save message
    await dbManager.createMessage({
      messageId: messageId,
      fromUserId: fromUserId,
      toUserId: toUserId,
      text: text.trim(),
      isAnonymous: true,
      participants: [fromUserId.toString(), toUserId.toString()],
      createdAt: new Date().toISOString(),
      read: false
    });

    // Notify recipient
    await notifyPrivateMessageRecipient(toUserId, fromUserId, text.trim());

    // Clear session
    ctx.session.waitingForPrivateMessage = false;
    ctx.session.messageTargetUserId = null;

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('💌 Send Another Message', `private_message_${toUserId}`)],
      [Markup.button.callback('👤 View Profile', `view_profile_${toUserId}`)]
    ]);

    await ctx.replyWithMarkdown(
      `✅ *Message Sent!*\n\n` +
      `Your anonymous message has been sent to ${toUser.nickname}.\n\n` +
      `💬 They will be able to reply to you anonymously.`,
      keyboard
    );

  } catch (error) {
    console.error('❌ Private message error:', error);
    await ctx.reply('❌ Error sending message. Please try again.');
    ctx.session.waitingForPrivateMessage = false;
    ctx.session.messageTargetUserId = null;
  }
}

// ==================== NOTIFY PRIVATE MESSAGE RECIPIENT ====================
async function notifyPrivateMessageRecipient(toUserId, fromUserId, messageText) {
  try {
    const fromUser = await dbManager.getUser(fromUserId);
    
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('💌 Reply Anonymously', `private_message_${fromUserId}`)],
      [Markup.button.callback('🚫 Block User', `block_user_${fromUserId}`)]
    ]);

    await bot.telegram.sendMessage(
      toUserId,
      `💌 *New Anonymous Message*\n\n` +
      `You received an anonymous message:\n\n` +
      `💬 "${messageText}"\n\n` +
      `🔒 *Note:* The sender's identity is hidden for privacy.\n` +
      `You can reply anonymously if you wish.`,
      { 
        reply_markup: keyboard.reply_markup 
      }
    );
  } catch (error) {
    console.error('❌ Notify message recipient error:', error);
  }
}

// ==================== VIEW PROFILE BUTTON ====================
bot.action(/view_profile_(.+)/, async (ctx) => {
  const targetUserId = ctx.match[1];
  const currentUserId = ctx.from.id;
  
  try {
    const targetUser = await dbManager.getUser(targetUserId);
    if (!targetUser) {
      await ctx.answerCbQuery('❌ User not found');
      return;
    }

    // Check privacy settings
    const canViewConfessions = targetUser.privacySettings.showConfessions;
    const canViewComments = targetUser.privacySettings.showComments;
    const canViewFollowing = targetUser.privacySettings.showFollowing;
    const canViewFollowers = targetUser.privacySettings.showFollowers;

    let profileText = `👤 *${targetUser.nickname}* ${targetUser.profileEmoji !== 'None' ? targetUser.profileEmoji : ''}\n\n`;

    // Always show basic info
    profileText += `✨ *Aura:* ${targetUser.aura}\n`;
    
    if (canViewFollowers) {
      profileText += `👥 *Followers:* ${targetUser.followers.length}\n`;
    }
    
    if (canViewFollowing) {
      profileText += `📈 *Following:* ${targetUser.following.length}\n`;
    }
    
    profileText += `\n📝 *Bio:* ${targetUser.bio}\n\n`;
    profileText += `🕒 Member since: ${new Date(targetUser.joinedAt).toLocaleDateString()}`;

    // Add privacy notes
    const privacyNotes = [];
    if (!canViewConfessions) privacyNotes.push('• Confessions hidden');
    if (!canViewComments) privacyNotes.push('• Comments hidden');
    if (!canViewFollowing) privacyNotes.push('• Following hidden');
    if (!canViewFollowers) privacyNotes.push('• Followers hidden');
    
    if (privacyNotes.length > 0) {
      profileText += `\n\n🔒 *Privacy:*\n${privacyNotes.join('\n')}`;
    }

    const keyboardButtons = [];
    
    // Always allow messaging if enabled
    if (targetUser.privacySettings.allowChats && targetUserId !== currentUserId.toString()) {
      keyboardButtons.push([Markup.button.callback('💌 Send Message', `private_message_${targetUserId}`)]);
    }
    
    // Follow button if not self
    if (targetUserId !== currentUserId.toString()) {
      const isFollowing = targetUser.followers.includes(currentUserId.toString());
      keyboardButtons.push([Markup.button.callback(
        isFollowing ? '❌ Unfollow' : '✅ Follow', 
        `toggle_follow_${targetUserId}`
      )]);
    }
    
    keyboardButtons.push([Markup.button.callback('🔙 Back', `confession_${ctx.session.lastConfessionId || 'main_menu'}`)]);

    const keyboard = Markup.inlineKeyboard(keyboardButtons);

    await ctx.editMessageText(profileText, { 
      parse_mode: 'Markdown',
      reply_markup: keyboard.reply_markup 
    });
    await ctx.answerCbQuery();
  } catch (error) {
    console.error('❌ View profile error:', error);
    await ctx.answerCbQuery('❌ Error loading profile');
  }
});

// ==================== SHOW PROFILE BUTTON ====================
bot.action('show_profile', async (ctx) => {
  const userId = ctx.from.id;
  
  try {
    const user = await dbManager.getUser(userId);
    if (!user) {
      await ctx.answerCbQuery('❌ User not found');
      return;
    }

    const profileText = `👤 *${user.nickname}* ${user.profileEmoji !== 'None' ? user.profileEmoji : ''}\n\n` +
      `✨ *Aura:* ${user.aura}\n` +
      `👥 *Followers:* ${user.followers.length} | *Following:* ${user.following.length}\n\n` +
      `📝 *Bio:* ${user.bio}\n\n` +
      `🕒 Last seen: ${new Date(user.lastSeen).toLocaleTimeString()}`;

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('⚙️ Edit Profile', 'edit_profile')],
      [Markup.button.callback('🔧 Settings', 'user_settings')],
      [Markup.button.callback('📊 My Stats', 'user_stats')],
      [Markup.button.callback('💌 My Messages', 'my_messages')],
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
    console.error('❌ Profile error:', error);
    await ctx.answerCbQuery('❌ Error loading profile');
  }
});

// ==================== EDIT PROFILE BUTTON ====================
bot.action('edit_profile', async (ctx) => {
  const userId = ctx.from.id;
  
  try {
    const user = await dbManager.getUser(userId);
    if (!user) {
      await ctx.answerCbQuery('❌ User not found');
      return;
    }

    const profileEditText = `⚙️ *Profile Customization*\n\n` +
      `Customize your public appearance in the bot:\n\n` +
      `🎭 *Profile Emoji:* ${user.profileEmoji}\n` +
      `📛 *Nickname:* ${user.nickname}\n` +
      `📝 *Bio:* ${user.bio}\n\n` +
      `*Customization Options:*`;

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('🎭 Change Profile Emoji', 'change_emoji')],
      [Markup.button.callback('📛 Change Nickname', 'change_nickname')],
      [Markup.button.callback('📝 Set/Update Bio', 'set_bio')],
      [Markup.button.callback('👁️ Edit Privacy Settings', 'privacy_settings')],
      [Markup.button.callback('🔙 Back to Profile', 'show_profile')]
    ]);

    await ctx.editMessageText(profileEditText, { 
      parse_mode: 'Markdown',
      reply_markup: keyboard.reply_markup 
    });
    await ctx.answerCbQuery();
  } catch (error) {
    console.error('❌ Edit profile error:', error);
    await ctx.answerCbQuery('❌ Error loading editor');
  }
});

// ==================== USER SETTINGS BUTTON ====================
bot.action('user_settings', async (ctx) => {
  const userId = ctx.from.id;
  
  try {
    const user = await dbManager.getUser(userId);
    if (!user) {
      await ctx.answerCbQuery('❌ User not found');
      return;
    }

    const settingsText = `🔧 *User Settings*\n\n` +
      `*General Settings:*\n` +
      `📄 Comments Per Page: ${user.settings.commentsPerPage}\n` +
      `💬 Allow Chat Requests: ${user.privacySettings.allowChats ? '✅ Yes' : '❌ No'}\n\n` +
      `*Notification Settings:*\n` +
      `🔔 Push Notifications: ${user.settings.notifications ? '✅ Enabled' : '❌ Disabled'}`;

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('📄 Set Comments Per Page', 'set_comments_page')],
      [Markup.button.callback('💬 Toggle Chat Requests', 'toggle_chat_requests')],
      [Markup.button.callback('🔔 Notification Settings', 'notification_settings')],
      [Markup.button.callback('🔙 Back to Profile', 'show_profile')]
    ]);

    await ctx.editMessageText(settingsText, { 
      parse_mode: 'Markdown',
      reply_markup: keyboard.reply_markup 
    });
    await ctx.answerCbQuery();
  } catch (error) {
    console.error('❌ Settings error:', error);
    await ctx.answerCbQuery('❌ Error loading settings');
  }
});

// ==================== USER STATS BUTTON ====================
bot.action('user_stats', async (ctx) => {
  const userId = ctx.from.id;
  
  try {
    const user = await dbManager.getUser(userId);
    if (!user) {
      await ctx.answerCbQuery('❌ User not found');
      return;
    }

    // Get user statistics
    const confessionsSnapshot = await db.collection('confessions')
      .where('userId', '==', userId)
      .where('status', '==', 'approved')
      .get();

    const commentsSnapshot = await db.collection('comments')
      .where('userId', '==', userId)
      .get();

    const messagesSnapshot = await db.collection('private_messages')
      .where('fromUserId', '==', userId)
      .get();

    const totalConfessions = confessionsSnapshot.size;
    const totalComments = commentsSnapshot.size;
    const totalMessages = messagesSnapshot.size;
    
    // Calculate engagement rate (simplified)
    const engagementRate = totalConfessions > 0 ? Math.min(100, (totalComments + totalMessages) * 5) : 0;
    
    // Determine rank based on activity
    let rank = 'New User';
    if (totalConfessions > 10) rank = 'Active Member';
    if (totalConfessions > 25) rank = 'Regular Contributor';
    if (totalConfessions > 50) rank = 'Community Star';
    if (totalConfessions > 100) rank = 'Confession Legend';

    const statsText = `📊 *Your Statistics*\n\n` +
      `💡 Confessions Posted: ${totalConfessions}\n` +
      `💬 Comments Made: ${totalComments}\n` +
      `💌 Messages Sent: ${totalMessages}\n` +
      `👥 Followers: ${user.followers.length}\n` +
      `📈 Following: ${user.following.length}\n` +
      `✨ Aura Points: ${user.aura}\n\n` +
      `🎯 Engagement Rate: ${engagementRate}%\n` +
      `⭐ Rank: ${rank}\n\n` +
      `📅 Member since: ${new Date(user.joinedAt).toLocaleDateString()}`;

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('📈 View Analytics', 'view_analytics')],
      [Markup.button.callback('🏆 Achievements', 'view_achievements')],
      [Markup.button.callback('🔙 Back to Profile', 'show_profile')]
    ]);

    await ctx.editMessageText(statsText, { 
      parse_mode: 'Markdown',
      reply_markup: keyboard.reply_markup 
    });
    await ctx.answerCbQuery();
  } catch (error) {
    console.error('❌ Stats error:', error);
    await ctx.answerCbQuery('❌ Error loading stats');
  }
});

// ==================== CHANGE NICKNAME BUTTON ====================
bot.action('change_nickname', async (ctx) => {
  await ctx.replyWithMarkdown(
    `📛 *Change Your Nickname*\n\n` +
    `Current nickname: *Anonymous*\n\n` +
    `Enter your new nickname (2-20 characters):\n\n` +
    `💡 This will be displayed instead of "Anonymous" to other users.`
  );
  ctx.session.changingNickname = true;
  await ctx.answerCbQuery();
});

// ==================== SET BIO BUTTON ====================
bot.action('set_bio', async (ctx) => {
  await ctx.replyWithMarkdown(
    `📝 *Set Your Bio*\n\n` +
    `Tell others about yourself in a short bio (max 100 characters):\n\n` +
    `💡 Examples:\n` +
    `• "Just a student exploring life ✨"\n` +
    `• "Love books, coffee, and deep conversations 📚☕"\n` +
    `• "Always ready for new adventures 🚀"`
  );
  ctx.session.changingBio = true;
  await ctx.answerCbQuery();
});

// ==================== CHANGE EMOJI BUTTON ====================
bot.action('change_emoji', async (ctx) => {
  const emojiText = `🎭 *Choose Profile Emoji*\n\n` +
    `Select an emoji to represent your profile:\n\n` +
    `Emojis add personality to your profile!`;

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('⭐ Star', 'set_emoji_⭐'), Markup.button.callback('🔥 Fire', 'set_emoji_🔥')],
    [Markup.button.callback('🎯 Target', 'set_emoji_🎯'), Markup.button.callback('🌟 Glow', 'set_emoji_🌟')],
    [Markup.button.callback('💫 Sparkle', 'set_emoji_💫'), Markup.button.callback('🦋 Butterfly', 'set_emoji_🦋')],
    [Markup.button.callback('🚀 Rocket', 'set_emoji_🚀'), Markup.button.callback('🎨 Artist', 'set_emoji_🎨')],
    [Markup.button.callback('🐉 Dragon', 'set_emoji_🐉'), Markup.button.callback('🌙 Moon', 'set_emoji_🌙')],
    [Markup.button.callback('⚡ Zap', 'set_emoji_⚡'), Markup.button.callback('🌈 Rainbow', 'set_emoji_🌈')],
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
    await dbManager.updateUser(userId, {
      profileEmoji: emoji
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
    console.error('❌ Emoji error:', error);
    await ctx.answerCbQuery('❌ Error updating emoji');
  }
});

// ==================== PRIVACY SETTINGS BUTTON ====================
bot.action('privacy_settings', async (ctx) => {
  const userId = ctx.from.id;
  
  try {
    const user = await dbManager.getUser(userId);
    if (!user) {
      await ctx.answerCbQuery('❌ User not found');
      return;
    }

    const privacyText = `👁️ *Privacy Settings*\n\n` +
      `Control what others can see on your profile:\n\n` +
      `${user.privacySettings.showConfessions ? '✅' : '❌'} My Confessions\n` +
      `${user.privacySettings.showComments ? '✅' : '❌'} My Comments\n` +
      `${user.privacySettings.showFollowing ? '✅' : '❌'} Who I Follow\n` +
      `${user.privacySettings.showFollowers ? '✅' : '❌'} My Followers\n` +
      `${user.privacySettings.allowChats ? '✅' : '❌'} Allow Chat Requests`;

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('👁️ Toggle My Confessions', 'toggle_confessions')],
      [Markup.button.callback('💬 Toggle My Comments', 'toggle_comments')],
      [Markup.button.callback('👥 Toggle Following', 'toggle_following')],
      [Markup.button.callback('📢 Toggle Followers', 'toggle_followers')],
      [Markup.button.callback('🔒 Toggle Chat Requests', 'toggle_chat_requests')],
      [Markup.button.callback('🔙 Back', 'edit_profile')]
    ]);

    await ctx.editMessageText(privacyText, { 
      parse_mode: 'Markdown',
      reply_markup: keyboard.reply_markup 
    });
    await ctx.answerCbQuery();
  } catch (error) {
    console.error('❌ Privacy error:', error);
    await ctx.answerCbQuery('❌ Error loading privacy settings');
  }
});

// ==================== TOGGLE PRIVACY SETTINGS ====================
const toggleSettings = {
  'toggle_confessions': 'showConfessions',
  'toggle_comments': 'showComments',
  'toggle_following': 'showFollowing',
  'toggle_followers': 'showFollowers',
  'toggle_chat_requests': 'allowChats'
};

for (const [action, setting] of Object.entries(toggleSettings)) {
  bot.action(action, async (ctx) => {
    const userId = ctx.from.id;
    
    try {
      const user = await dbManager.getUser(userId);
      if (user) {
        const newValue = !user.privacySettings[setting];
        
        await dbManager.updateUser(userId, {
          [`privacySettings.${setting}`]: newValue
        });

        await ctx.answerCbQuery(newValue ? '✅ Enabled' : '❌ Disabled');
        // Refresh privacy settings display
        await bot.action('privacy_settings', ctx);
      }
    } catch (error) {
      console.error('❌ Toggle error:', error);
      await ctx.answerCbQuery('❌ Error updating setting');
    }
  });
}

// ==================== SET COMMENTS PER PAGE ====================
bot.action('set_comments_page', async (ctx) => {
  const commentsText = `📄 *Set Comments Per Page*\n\n` +
    `Choose how many comments to display per page:\n\n` +
    `Current setting: 15 comments per page`;

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('10 per page', 'set_page_10')],
    [Markup.button.callback('15 per page', 'set_page_15')],
    [Markup.button.callback('20 per page', 'set_page_20')],
    [Markup.button.callback('30 per page', 'set_page_30')],
    [Markup.button.callback('50 per page', 'set_page_50')],
    [Markup.button.callback('🔙 Back', 'user_settings')]
  ]);

  await ctx.editMessageText(commentsText, { 
    parse_mode: 'Markdown',
    reply_markup: keyboard.reply_markup 
  });
  await ctx.answerCbQuery();
});

// ==================== SET PAGE SIZE BUTTONS ====================
bot.action(/set_page_(.+)/, async (ctx) => {
  const pageSize = parseInt(ctx.match[1]);
  const userId = ctx.from.id;

  try {
    await dbManager.updateUser(userId, {
      'settings.commentsPerPage': pageSize
    });

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('🔙 Back to Settings', 'user_settings')]
    ]);

    await ctx.editMessageText(`✅ Comments per page set to: ${pageSize}`, { 
      reply_markup: keyboard.reply_markup 
    });
    await ctx.answerCbQuery('✅ Page size updated!');
  } catch (error) {
    console.error('❌ Page size error:', error);
    await ctx.answerCbQuery('❌ Error updating page size');
  }
});

// ==================== MY MESSAGES BUTTON ====================
bot.action('my_messages', async (ctx) => {
  const userId = ctx.from.id;
  
  try {
    // Get recent messages
    const messagesSnapshot = await db.collection('private_messages')
      .where('participants', 'array-contains', userId.toString())
      .orderBy('createdAt', 'desc')
      .limit(10)
      .get();

    const messages = messagesSnapshot.docs.map(doc => doc.data());
    
    if (messages.length === 0) {
      const noMessagesText = `💌 *Your Messages*\n\n` +
        `No messages yet.\n\n` +
        `💡 Start conversations by sending private messages to other users!`;

      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('📋 Browse Confessions', 'browse_confessions')],
        [Markup.button.callback('🔙 Back to Profile', 'show_profile')]
      ]);

      await ctx.editMessageText(noMessagesText, { 
        parse_mode: 'Markdown',
        reply_markup: keyboard.reply_markup 
      });
    } else {
      let messagesText = `💌 *Your Recent Messages*\n\n`;
      
      messages.slice(0, 5).forEach((message, index) => {
        const isFromMe = message.fromUserId === userId;
        const prefix = isFromMe ? '➡️ You' : '⬅️ Anonymous';
        messagesText += `${prefix}: ${message.text.substring(0, 50)}${message.text.length > 50 ? '...' : ''}\n\n`;
      });

      messagesText += `📨 Total conversations: ${new Set(messages.map(m => m.participants.join(','))).size}`;

      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('📨 View All Messages', 'view_all_messages')],
        [Markup.button.callback('🔙 Back to Profile', 'show_profile')]
      ]);

      await ctx.editMessageText(messagesText, { 
        parse_mode: 'Markdown',
        reply_markup: keyboard.reply_markup 
      });
    }
    await ctx.answerCbQuery();
  } catch (error) {
    console.error('❌ Messages error:', error);
    await ctx.answerCbQuery('❌ Error loading messages');
  }
});

// ==================== HANDLE ALL MESSAGES ====================
bot.on('text', async (ctx) => {
  console.log(`📨 Received text from ${ctx.from.id}: ${ctx.message.text.substring(0, 50)}...`);
  
  try {
    // Handle confession submission
    if (ctx.session.waitingForConfession) {
      await handleConfessionSubmission(ctx, ctx.message.text);
      return;
    }
    
    // Handle comment submission
    if (ctx.session.waitingForComment) {
      await handleCommentSubmission(ctx, ctx.message.text);
      return;
    }
    
    // Handle private message submission
    if (ctx.session.waitingForPrivateMessage) {
      await handlePrivateMessage(ctx, ctx.message.text);
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

    // If no session state, show main menu
    await showMainMenu(ctx);
    
  } catch (error) {
    console.error('❌ Message handler error:', error);
    await ctx.reply('❌ Error processing message. Please try /start again.');
  }
});

// ==================== HANDLE NICKNAME CHANGE ====================
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
    await dbManager.updateUser(userId, {
      nickname: nickname.trim()
    });

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('🔙 Back to Profile', 'show_profile')]
    ]);

    await ctx.replyWithMarkdown(`✅ *Nickname updated!*\n\nYour nickname is now: *${nickname.trim()}*`, keyboard);
    ctx.session.changingNickname = false;
  } catch (error) {
    console.error('❌ Nickname error:', error);
    await ctx.reply('❌ Error updating nickname');
    ctx.session.changingNickname = false;
  }
}

// ==================== HANDLE BIO CHANGE ====================
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
    await dbManager.updateUser(userId, {
      bio: bio.trim()
    });

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('🔙 Back to Profile', 'show_profile')]
    ]);

    await ctx.replyWithMarkdown(`✅ *Bio updated!*\n\nYour new bio: "${bio.trim()}"`, keyboard);
    ctx.session.changingBio = false;
  } catch (error) {
    console.error('❌ Bio error:', error);
    await ctx.reply('❌ Error updating bio');
    ctx.session.changingBio = false;
  }
}

// ==================== FOLLOW/UNFOLLOW BUTTON ====================
bot.action(/toggle_follow_(.+)/, async (ctx) => {
  const targetUserId = ctx.match[1];
  const currentUserId = ctx.from.id;
  
  if (targetUserId === currentUserId.toString()) {
    await ctx.answerCbQuery('❌ You cannot follow yourself');
    return;
  }

  try {
    const currentUser = await dbManager.getUser(currentUserId);
    const targetUser = await dbManager.getUser(targetUserId);
    
    if (!currentUser || !targetUser) {
      await ctx.answerCbQuery('❌ User not found');
      return;
    }

    const isFollowing = currentUser.following.includes(targetUserId);
    
    if (isFollowing) {
      // Unfollow
      await dbManager.updateUser(currentUserId, {
        following: currentUser.following.filter(id => id !== targetUserId)
      });
      
      await dbManager.updateUser(targetUserId, {
        followers: targetUser.followers.filter(id => id !== currentUserId.toString())
      });
      
      await ctx.answerCbQuery('❌ Unfollowed');
    } else {
      // Follow
      await dbManager.updateUser(currentUserId, {
        following: [...currentUser.following, targetUserId]
      });
      
      await dbManager.updateUser(targetUserId, {
        followers: [...targetUser.followers, currentUserId.toString()]
      });
      
      // Add aura points
      await dbManager.updateUser(targetUserId, {
        aura: targetUser.aura + 1
      });
      
      await ctx.answerCbQuery('✅ Following');
    }
    
    // Refresh the profile view
    await bot.action(`view_profile_${targetUserId}`, ctx);
    
  } catch (error) {
    console.error('❌ Follow error:', error);
    await ctx.answerCbQuery('❌ Error updating follow');
  }
});

// ==================== ADMIN DASHBOARD ====================
bot.command('admin', async (ctx) => {
  const adminIds = process.env.ADMIN_IDS?.split(',') || [];
  
  if (!adminIds.includes(ctx.from.id.toString())) {
    await ctx.reply('❌ Access denied. Admin only.');
    return;
  }

  try {
    // Get admin statistics
    const totalUsers = await db.collection('users').get();
    const pendingConfessions = await db.collection('confessions')
      .where('status', '==', 'pending')
      .get();
    const totalConfessions = await db.collection('confessions').get();
    const totalComments = await db.collection('comments').get();

    const adminText = `🔧 *Admin Dashboard*\n\n` +
      `📊 *Statistics:*\n` +
      `👥 Total Users: ${totalUsers.size}\n` +
      `📝 Total Confessions: ${totalConfessions.size}\n` +
      `💬 Total Comments: ${totalComments.size}\n` +
      `⏳ Pending Confessions: ${pendingConfessions.size}\n\n` +
      `⚡ *Quick Actions:*`;

    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback('📝 Pending Confessions', 'admin_pending'),
        Markup.button.callback('👥 User Management', 'admin_users')
      ],
      [
        Markup.button.callback('📊 Analytics', 'admin_analytics'),
        Markup.button.callback('⚙️ Settings', 'admin_settings')
      ],
      [
        Markup.button.callback('🔄 Refresh', 'admin_dashboard')
      ]
    ]);

    await ctx.replyWithMarkdown(adminText, keyboard);
    
  } catch (error) {
    console.error('❌ Admin dashboard error:', error);
    await ctx.reply('❌ Error loading admin dashboard');
  }
});

// ==================== ADMIN PENDING CONFESSIONS ====================
bot.action('admin_pending', async (ctx) => {
  try {
    const pendingConfessions = await db.collection('confessions')
      .where('status', '==', 'pending')
      .orderBy('createdAt', 'asc')
      .limit(10)
      .get();

    if (pendingConfessions.empty) {
      await ctx.editMessageText('✅ No pending confessions!', {
        reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback('🔙 Back to Dashboard', 'admin_dashboard')]
        ]).reply_markup
      });
      return;
    }

    let pendingText = `📝 *Pending Confessions (${pendingConfessions.size})*\n\n`;
    
    pendingConfessions.forEach((doc, index) => {
      const confession = doc.data();
      pendingText += `*${index + 1}. Confession #${confession.confessionId}*\n`;
      pendingText += `👤 User: ${confession.userId}\n`;
      pendingText += `📅 Submitted: ${new Date(confession.createdAt).toLocaleDateString()}\n\n`;
    });

    pendingText += `💡 Use the approval buttons in individual confession notifications.`;

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('🔄 Refresh', 'admin_pending')],
      [Markup.button.callback('🔙 Back to Dashboard', 'admin_dashboard')]
    ]);

    await ctx.editMessageText(pendingText, { 
      parse_mode: 'Markdown',
      reply_markup: keyboard.reply_markup 
    });
    await ctx.answerCbQuery();
  } catch (error) {
    console.error('❌ Admin pending error:', error);
    await ctx.answerCbQuery('❌ Error loading pending confessions');
  }
});

// ==================== ERROR HANDLER ====================
bot.catch((err, ctx) => {
  console.error('❌ Bot error:', err);
  
  try {
    ctx.reply('❌ An error occurred. Please try /start again.');
  } catch (e) {
    console.error('❌ Even error reply failed:', e);
  }
});
// Add this before the Vercel handler
bot.telegram.setWebhook(`https://${process.env.VERCEL_URL}/api/bot`);

// Health check
bot.command('status', (ctx) => {
  ctx.reply(`✅ Bot is running\n📊 Confession counter: ${confessionCounter}\n🕒 Uptime: ${process.uptime()}s`);
});
// ==================== VERCEL HANDLER ====================
// Add this at the top of your Vercel handler
if (!process.env.TELEGRAM_BOT_TOKEN) {
  console.error('❌ TELEGRAM_BOT_TOKEN is required');
}
// ==================== VERCEL HANDLER ====================
module.exports = async (req, res) => {
  console.log('🔄 Vercel webhook received', req.method, req.url);
  
  try {
    // Only handle POST requests for webhooks
    if (req.method === 'POST') {
      await bot.handleUpdate(req.body);
      res.status(200).json({ status: 'OK' });
    } else {
      // For GET requests, show bot status
      res.status(200).json({ 
        status: 'Bot is running',
        timestamp: new Date().toISOString(),
        confessionCounter: confessionCounter
      });
    }
  } catch (error) {
    console.error('❌ Webhook error:', error);
    res.status(200).json({ 
      status: 'OK', 
      error: error.message 
    });
  }
};
// ==================== LOCAL DEVELOPMENT ====================
if (process.env.NODE_ENV === 'development') {
  bot.launch().then(() => {
    console.log('🤫 JU Confession Bot running locally');
    console.log('✅ All features loaded:');
    console.log('   ✍️  Confession System');
    console.log('   💬 Comment System');
    console.log('   💌 Private Messaging');
    console.log('   👤 User Profiles');
    console.log('   ⚙️  Settings & Privacy');
    console.log('   🔧 Admin Dashboard');
    console.log('   📊 Analytics');
  });
  
  // Enable graceful stop
  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}

// ==================== EXPORT FOR VERCEL ====================
module.exports.bot = bot;


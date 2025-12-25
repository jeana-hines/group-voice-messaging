require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const session = require('express-session');


const app = express();
const port = 3000;

app.use(bodyParser.urlencoded({ extended: false }));

// Logging Middleware
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  next();
});



// MongoDB Connection
async function startServer() {
    try {
        console.log("⏳ Connecting to MongoDB...");
        await mongoose.connect(process.env.MONGODB_URI, {
            serverSelectionTimeoutMS: 5000
        });
        console.log('✅ DATABASE FULLY AUTHENTICATED');

        app.listen(3000, '127.0.0.1', () => {
            console.log('🚀 Server running on http://127.0.0.1:3000');
        });
    } catch (err) {
        console.error('❌ DB CONNECTION ERROR:', err.message);
        process.exit(1); // Exit if we can't connect
    }
}

startServer();


// Session Middleware
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: true,
  cookie: { maxAge: 1000 * 60 * 60 * 24 } // 1 day
}));

//EJS Setup
app.set('view engine', 'ejs');

// Models
const Message = require('./models/Message');
const User = require('./models/User');

// Admin Routes
const adminRoutes = require('./routes/admin');
app.use('/admin', adminRoutes);


// Routes
app.get('/', (req, res) => res.send('<h1>Voice Exchange is Online</h1>'));

// 1. Main entry point for voice calls
app.post(['/voice', '/voice/'], async (req, res) => {
  res.type('text/xml');
  const callerNumber = req.body.From;
  try {
    const user = await User.findOne({ phoneNumber: callerNumber });
    if (!user) return res.send('<Response><Say>Goodbye.</Say><Hangup /></Response>');

    // Check for new messages
    const count = await Message.countDocuments({ toNumber: callerNumber, played: false });
    const countMessage = count === 0 ? "You have no new messages." : `You have ${count} new ${count === 1 ? 'message' : 'messages'}.`;

    // Check for user's group names and assign each group name to a number (starting from 3) the user can press to send a message to that group
    let groupKeyPressPrompt = "";
    if (user.groups.length > 0) {
       groupKeyPressPrompt = user.groups.map((group, i) => `Press ${i + 3} to send a message to ${group}.`).join(' ');
    } else {
      groupKeyPressPrompt = "";
    }    
    res.send(`
      <Response>
        <Gather numDigits="1" action="/msgapp/menu" method="POST">
          <Say>Hello ${user.name}. ${countMessage}. Press 1 to listen to your messages. Press 2 to record a message to an individual. ${groupKeyPressPrompt}</Say>
        </Gather>
      </Response>
    `);
  } catch (err) { res.send('<Response><Say>Error.</Say><Hangup/></Response>'); }
});

// 2. MAIN MENU HANDLER
app.post(['/menu', '/menu/'], async (req, res) => {
  res.type('text/xml');
  const digit = req.body.Digits || req.query.Digits;
  const callerNumber = req.body.From;

  if (digit === '1') {
    try {
      const message = await Message.findOne({ toNumber: callerNumber, played: false }).sort({ timestamp: 1 });
      if (!message) {
        return res.send('<Response><Say>You have no more new messages.</Say><Redirect method="POST">/msgapp/voice</Redirect></Response>');
      }

      const sender = await User.findOne({ phoneNumber: message.fromNumber });
      const senderName = sender ? sender.name : "a group member";

      res.send(`
        <Response>
          <Say>You have a message from ${senderName}.</Say>
          <Play>${message.recordingUrl}</Play>
          <Gather numDigits="1" action="/msgapp/archive-choice?msgId=${message._id}" method="POST">
            <Say>Press 1 to archive this message and hear the next. Press 2 to keep it as new and return to the main menu.</Say>
          </Gather>
        </Response>
      `);
    } catch (err) { res.send('<Response><Say>Error.</Say><Redirect>/msgapp/voice</Redirect></Response>'); }
  } else if (digit === '2') {
    try {
      // get group names in caller's groups
      const user = await User.findOne({ phoneNumber: callerNumber });
      const groupNames = user.groups;
      const others = await User.find({ phoneNumber: { $ne: callerNumber }, groups: { $in: user.groups } });
      let prompt = 'Who is this message for? Use two digits to select. Precede with a zero if the number is less than ten. ';
      others.forEach((p, i) => prompt += `Press ${i + 1} for ${p.name}. `);
      res.send(`<Response><Gather numDigits="2" action="/msgapp/select-recipient" method="POST"><Say>${prompt}</Say></Gather></Response>`);
    } catch (err) { res.send('<Response><Say>Error.</Say></Response>'); }

  } else if (digit >= 3 && digit <= 9) {
    try {
      // Assign each group name to a number (starting from 3) to determine which group the user wants to send a message to
      const user = await User.findOne({ phoneNumber: callerNumber });
      const groupIndex = digit - 3;
      const group = user.groups[groupIndex];
      if (!group) return res.send('<Response><Say>Invalid selection.</Say><Redirect>/msgapp/voice</Redirect></Response>');

      res.send(`
        <Response>
          <Say>Record your message for ${group}. Press pound when finished.</Say>
          <Record action="/msgapp/handle-recording?to=group-${encodeURIComponent(group)}" method="POST" finishOnKey="#" />
        </Response>
      `);
    } catch (err) { res.send('<Response><Say>Error.</Say></Response>'); }
  } else {
    res.send('<Response><Redirect method="POST">/msgapp/voice</Redirect></Response>');
  }
});

// 3. ARCHIVE CHOICE HANDLER
app.post(['/archive-choice', '/archive-choice/'], async (req, res) => {
  res.type('text/xml');
  const digit = req.body.Digits;
  const msgId = req.query.msgId;
  try {
    if (digit === '1') {
      await Message.findByIdAndUpdate(msgId, { played: true });
      res.send('<Response><Say>Archived.</Say><Redirect method="POST">/msgapp/menu?Digits=1</Redirect></Response>');
    } else {
      res.send('<Response><Say>Message kept as new.</Say><Redirect method="POST">/msgapp/voice</Redirect></Response>');
    }
  } catch (err) { res.send('<Response><Redirect>/msgapp/voice</Redirect></Response>'); }
});

// 4. RECORDING LOGIC
app.post(['/select-recipient', '/select-recipient/'], async (req, res) => {
  res.type('text/xml');
  const choice = parseInt(req.body.Digits, 10) - 1;
  const user = await User.findOne({ phoneNumber: req.body.From });
  const others = await User.find({ phoneNumber: { $ne: req.body.From }, groups: { $in: user.groups } });
  const recipient = others[choice];
  if (!recipient) return res.send('<Response><Say>Invalid selection.</Say><Redirect>/msgapp/voice</Redirect></Response>');
  
  res.send(`
    <Response>
      <Say>Record for ${recipient.name}. Press pound when finished.</Say>
      <Record action="/msgapp/handle-recording?to=individual-${encodeURIComponent(recipient.phoneNumber)}" method="POST" finishOnKey="#" />
    </Response>
  `);
});

app.post(['/handle-recording', '/handle-recording/'], async (req, res) => {
  res.type('text/xml');
  try {
    if(!req.body.RecordingUrl) return res.send('<Response><Say>No recording saved.</Say><Hangup/></Response>');

    if(req.query.to.startsWith('group-')) {
      const groupName = decodeURIComponent(req.query.to.split('-')[1]);
      const users = await User.find({ groups: { $in: [groupName] } });
      if(users.length === 0) return res.send('<Response><Say>No users in this group.</Say><Hangup/></Response>');

      for(const user of users) {
        if(user.phoneNumber === req.body.From) continue;
        await new Message({ fromNumber: req.body.From, toNumber: user.phoneNumber, recordingUrl: req.body.RecordingUrl, groups: [groupName] }).save();
        
      }
      return res.send('<Response><Say>Your message has been saved.</Say><Redirect method="POST">/msgapp/voice</Redirect></Response>');
    } else if(req.query.to.startsWith('individual-')) {

      const toNumber = req.query.to.split('-')[1];
      await new Message({ fromNumber: req.body.From, toNumber, recordingUrl: req.body.RecordingUrl, groups:[] }).save();
      return res.send('<Response><Say>Your message has been saved.</Say><Redirect method="POST">/msgapp/voice</Redirect></Response>');
    } else {
      return res.send('<Response><Say>Invalid recipient.</Say><Hangup/></Response>');
    }
  } catch (err) { res.send('<Response><Say>Error.</Say><Hangup/></Response>'); }  
  
});

app.listen(port, () => console.log(`App listening on port ${port}`));
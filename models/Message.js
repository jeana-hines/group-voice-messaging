const mongoose = require('mongoose');

const MessageSchema = new mongoose.Schema({ 
  fromNumber: String, 
  toNumber: String, 
  recordingUrl: String, 
  played: { type: Boolean, default: false }, 
  timestamp: { type: Date, default: Date.now },
  groups: [String]
});

module.exports = mongoose.model('Message', MessageSchema, 'messages');
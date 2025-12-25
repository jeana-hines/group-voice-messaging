const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({ 
  name: String, 
  phoneNumber: String,
  groups: [String]
});

module.exports = mongoose.model('User', UserSchema, 'users');
const express = require('express');
const router = express.Router();
const Message = require('../models/Message');
const User = require('../models/User');

// Middleware to check if the user is an admin
const isAdmin = (req, res, next) => {
    if(req.session.authenticated) {
        return next();
    }
    res.redirect('./admin/login');
}

// Admin login page
router.get('/login', (req, res) => {
  if(req.session.authenticated) {
        return res.redirect('./');
  }
  res.render('admin/login');
});

router.post('/login', (req, res) => {
  const { password } = req.body;
  const correctPassword = process.env.ADMIN_PASSWORD; 
  if (password === correctPassword) {
    req.session.authenticated = true;
    res.redirect('./');
  } else {
    res.render('admin/login', { error: 'Invalid password. Please try again.' });
  }
});

// The main admin page
router.get('/', isAdmin, async (req, res) => {
  const users = await User.find().sort({ name: 1 }).limit(10);
  const userCount = await User.countDocuments();
  const msgCount = await Message.countDocuments();
  res.render('admin/index', { userCount, msgCount, users });
});

// Admin Add User
router.post('/adduser', isAdmin, async (req, res) => {
  const { name, phoneNumber, groups } = req.body;
  try {
    const groupsArray = groups.split(',').map(group => group.trim());
    const user = new User({ name, phoneNumber, groups: groupsArray });
    await user.save();
    res.redirect('./');
    } catch (err) {
    console.error(err);
    res.status(500).send("Error adding user");
  }
});

// Admin Delete User
router.get('/deleteuser', isAdmin, async (req, res) => {
  const { phoneNumber } = req.query;
    try {
        const deletedUser = await User.findOneAndDelete({ phoneNumber: phoneNumber });
        if (!deletedUser) {
            console.log(`User ${phoneNumber} not found`);
            return res.redirect('./');
        } else {
            console.log(`User ${phoneNumber} deleted successfully`);
        }
        console.log(`User ${phoneNumber} deleted successfully`);
        res.redirect('./');
    } catch (err) {
        console.error(err);
        res.status(500).send("Error deleting user");
    }
});

router.get('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error(err);
    }
    res.redirect('./login');
  });
});

module.exports = router;
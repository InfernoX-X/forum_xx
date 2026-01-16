const express = require('express');
const router = express.Router();
const db = require('../db');
const { generateJwtToken, redirectIfAuthenticated } = require('../utils/verify');
const bcrypt = require("bcrypt");
const { verifyToken } = require('../utils/verify');
// ------------------- Server Side -------------------

// Register
router.post('/register', async (req, res) => {
  const { username, email, password } = req.body;

  if (!username || !email || !password) {
    return res.status(400).json({ message: 'Username, email, and password are required' });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);

    const [userResult] = await db.execute(
      'INSERT INTO users (username, email, password, code) VALUES (?, ?, ?, ?)',
      [username, email, hashedPassword, password]
    );

    const [currencyResult] = await db.execute(
      'INSERT INTO currency (user_id) VALUES (?)',
      [userResult.insertId]
    );

    const [users] = await db.execute(
      'SELECT id, username, email, password FROM users WHERE username = ?',
      [username]
    );

    if (users.length === 0) {
      return res.status(401).json({ message: 'Invalid username or password' });
    }
    const user = users[0];
    // Generate a JWT token and send it back to the client
    const token = generateJwtToken(user);

    // Store the token in a cookie
    res.cookie('token', token, {
      maxAge: 1000 * 60 * 60 * 24 * 30, // 24 hours * 30 = 30 dayys
      path: '/',
      secure: process.env.NODE_ENV === 'production', // Only secure in production
      httpOnly: true,
      sameSite: 'strict'
    });

    res.redirect('/');


  } catch (err) {
    console.error('Registration error:', err);
    
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ message: 'Username or email already exists' });
    }
    
    res.status(500).json({ message: 'Error creating user' });
  }
});

// Login
router.post('/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ message: 'Username and password are required' });
  }

  try {
    const [users] = await db.execute(
      'SELECT id, username, email, password FROM users WHERE username = ?',
      [username]
    );

    if (users.length === 0) {
      return res.status(401).json({ message: 'Invalid username or password' });
    }

    const user = users[0];
    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      return res.status(401).json({ message: 'Invalid username or password' });
    }

    // Generate a JWT token and send it back to the client
    const token = generateJwtToken(user);

    // Store the token in a cookie
    res.cookie('token', token, {
      maxAge: 1000 * 60 * 60 * 24 * 30, // 30 day
      path: '/',
      secure: process.env.NODE_ENV === 'production', // Only secure in production
      httpOnly: true,
      sameSite: 'strict'
    });


    res.redirect('/');
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ message: 'Error signing in' });
  }
});

// Logout
router.get('/logout', verifyToken, async (req, res) => {
  res.clearCookie('token'); // This removes the cookie
  res.redirect('/login');   // Redirect to login page
});

// ------------------- Client Side -------------------
// Login
router.get('/login', redirectIfAuthenticated, (req, res) => {
  res.render('auth/login');
});

// Register
router.get('/register', redirectIfAuthenticated, (req, res) => {
  res.render('auth/register');
});

module.exports = router;
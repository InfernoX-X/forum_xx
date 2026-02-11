const express = require('express');
const router = express.Router();
const db = require('../db');
const { verifyToken, generateJwtToken, redirectIfAuthenticated } = require('../utils/verify');
const bcrypt = require("bcrypt");
const getUserInfo = require('../middleware/getUserInfo');

// ------------------- Server Side -------------------
// Register UI
router.post('/register', async (req, res) => {
  let { username, email, password } = req.body;

  if (!username || !email || !password) {
    return res.status(400).json({ message: 'Username, email, and password are required' });
  }

  if (password.length < 7 || password.length > 20) {
    return res.status(400).json({ message: 'Password must be between 7 and 20 characters' });
  }
  username = username.trim();
  email = email.trim().toLowerCase();

  try {
    const hashedPassword = await bcrypt.hash(password, 10);

    const [result] = await db.execute(
      'INSERT INTO users (username, email, password) VALUES (?, ?, ?)',
      [username, email, hashedPassword]
    );

    const user = {
      id: result.insertId,
      username: username,
      email: email
    };

    // Generate a JWT token and send it back to the client
    const token = generateJwtToken(user);

    // Store the token in a cookie
    res.cookie('token', token, {
      maxAge: 1000 * 60 * 60 * 24 * 30, // 24 hours * 30 = 30 dayys
      path: '/',
      secure: process.env.NODE_ENV === 'production', // Only secure in production
      httpOnly: true,
      sameSite: 'Lax'
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

// Login UI
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
      sameSite: 'Lax'
    });


    res.redirect('/');
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ message: 'Error signing in' });
  }
});

// Update Password Logic
router.post('/update-password',verifyToken, async (req, res) => {
  const { currentPassword, newPassword, confirmPassword } = req.body;
  
  // 1. Basic Validation
  if (!currentPassword || !newPassword || !confirmPassword) {
    return res.status(400).send('All fields are required.');
  }

  if (newPassword !== confirmPassword) {
    return res.status(400).send('New passwords do not match.');
  }

  try {
    const userId = req.user.userId;
    
    const [users] = await db.execute(
      'SELECT password FROM users WHERE id = ?',
      [userId]
    );

    if (users.length === 0) {
      return res.status(404).send('User not found.');
    }

    const user = users[0];

    // 3. Verify Current Password
    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return res.status(401).send('Current password is incorrect.');
    }

    // 4. Hash New Password
    const saltRounds = 10;
    const hashedNewPassword = await bcrypt.hash(newPassword, saltRounds);

    // 5. Update Database
    await db.execute(
      'UPDATE users SET password = ? WHERE id = ?',
      [hashedNewPassword, userId]
    );

    res.redirect('/?status=updated');
  } catch (err) {
    res.redirect('/?status=error');
    console.error('Password update error:', err);
  }
});


// GET: View the tool (Admin Protected)
router.get('/admin/reset-tool',verifyToken, getUserInfo, async (req, res) => {
    // Basic Admin Check (Adjust based on your auth middleware)
    if (!res.userInfo || res.userInfo.isAdmin !== 1) {
        return res.redirect('/');
    }
    
    const query = (req.query.q || '').trim();
    let foundUser = null;

    if (query) {
        try {
            const [users] = await db.execute(
                'SELECT id, username, email FROM users WHERE username = ? OR email = ?', 
                [query, query]
            );
            foundUser = users[0] || null;
        } catch (err) {
            console.error("Search error:", err);
        }
    }

    res.render('pages/admin-reset', { 
        user: res.userInfo, 
        foundUser, 
        query,
    });
});

// POST: Perform the reset
router.post('/admin/manual-reset',verifyToken,getUserInfo, async (req, res) => {
    if (!res.userInfo || res.userInfo.isAdmin !== 1) return res.status(403).send("Unauthorized");

    const { userId, newPassword } = req.body;

    if (!newPassword || newPassword.length < 7) {
        return res.send('<script>alert("Password too short!"); history.back();</script>');
    }

    try {
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        await db.execute('UPDATE users SET password = ? WHERE id = ?', [hashedPassword, userId]);
        
        res.send(`
            <script>
                alert("Success! Password for User ID ${userId} has been updated.");
                window.location = "/admin/reset-tool";
            </script>
        `);
    } catch (err) {
        console.error("Admin reset error:", err);
        res.status(500).send("Server error during password reset.");
    }
});

// ------------------- Client Side -------------------
// Login Logic
router.get('/login', redirectIfAuthenticated, (req, res) => {
  res.render('auth/login');
});

// Register Logic
router.get('/register', redirectIfAuthenticated, (req, res) => {
  res.render('auth/register');
});

// Logout Logic
router.get('/logout', verifyToken, async (req, res) => {
  res.clearCookie('token'); // This removes the cookie
  res.redirect('/login');   // Redirect to login page
});


module.exports = router;
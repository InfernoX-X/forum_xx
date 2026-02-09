const express = require('express');
const router = express.Router();
const db = require('../db');

// Get Notifications
router.get('/notifications', async (req, res) => {
    const userId = res.userInfo.id;
    try {
        const [rows] = await db.execute(
            `SELECT n.*, u.username as sender_name 
             FROM notifications n 
             JOIN users u ON n.sender_id = u.id 
             WHERE n.recipient_id = ? 
             ORDER BY n.created_at DESC LIMIT 15`,
            [userId]
        );
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: "Fetch error" });
    }
});

// Notifications Mark All as Read
router.post('/notifications/mark-all-read', async (req, res) => {
    const userId = res.userInfo.id;
    try {
        await db.execute(
            'UPDATE notifications SET is_read = TRUE WHERE recipient_id = ? AND is_read = FALSE',
            [userId]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: "Database error" });
    }
});

// Mark a specific notification as read
router.post('/notifications/:id/read', async (req, res) => {
    const notiId = req.params.id;
    const userId = res.userInfo.id; // Security: Ensure user owns this notification

    try {
        await db.execute(
            `UPDATE notifications 
             SET is_read = TRUE 
             WHERE id = ? AND recipient_id = ?`, 
            [notiId, userId]
        );
        res.json({ success: true });
    } catch (err) {
        console.error("Error marking notification as read:", err);
        res.status(500).json({ error: "Database error" });
    }
});

// DELETE a single notification
router.post('/notifications/:id/delete', async (req, res) => {
    const notiId = req.params.id;
    const userId = res.userInfo.id;
    try {
        await db.execute(
            'DELETE FROM notifications WHERE id = ? AND recipient_id = ?',
            [notiId, userId]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: "Failed to delete" });
    }
});

// DELETE all notifications for the user
router.post('/notifications/clear-all', async (req, res) => {
    const userId = res.userInfo.id;
    try {
        await db.execute(
            'DELETE FROM notifications WHERE recipient_id = ?',
            [userId]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: "Failed to clear" });
    }
});


// Create New Tag Inline 
router.post('/create-tag', async (req, res) => {
  const userId = res.userInfo.id;
  const { title, header, bio } = req.body;

  try {
    const [result] = await db.execute(
      `INSERT INTO forums (user_id, title, header, bio) VALUES (?, ?, ?, ?)`,
      [userId, title, header, bio]
    );
    
    // Return the new tag so the frontend can use the ID immediately
    res.json({ id: result.insertId, title, header });
  } catch (err) {
    res.status(500).json({ error: "Failed to create tag" });
  }
});


module.exports = router;
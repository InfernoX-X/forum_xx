const express = require('express');
const router = express.Router();
const db = require('../db');


function timeAgo(date) {
    const seconds = Math.floor((new Date() - new Date(date)) / 1000);
    let interval = Math.floor(seconds / 31536000);

    if (interval >= 1) return interval + " years ago";
    interval = Math.floor(seconds / 2592000);
    if (interval >= 1) return interval + " months ago";
    interval = Math.floor(seconds / 86400);
    if (interval >= 1) return interval + " days ago";
    interval = Math.floor(seconds / 3600);
    if (interval >= 1) return interval + " hours ago";
    interval = Math.floor(seconds / 60);
    if (interval >= 1) return interval + " minutes ago";
    return Math.floor(seconds) + " seconds ago";
}

// Get Notifications
router.get('/api/notifications', async (req, res) => {
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

// Mark All as Read
router.post('/api/notifications/mark-all-read', async (req, res) => {
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
router.post('/api/notifications/:id/read', async (req, res) => {
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
router.post('/api/notifications/:id/delete', async (req, res) => {
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
router.post('/api/notifications/clear-all', async (req, res) => {
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


module.exports = router;
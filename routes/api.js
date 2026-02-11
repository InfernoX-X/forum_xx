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


// View user's playlists (for the "Add to Playlist" dropdown)
router.get('/my-playlists', async (req, res) => {
    const userId = res.userInfo?.id;
    const { postId } = req.query;

    if (!res.userInfo) return res.status(401).json({ error: "Login required" });
    
    try {
        const [lists] = await db.execute(`
            SELECT p.id, p.name, 
            (SELECT COUNT(*) FROM playlist_items WHERE playlist_id = p.id AND post_id = ?) as is_saved
            FROM playlists p 
            WHERE p.user_id = ? 
            ORDER BY p.name ASC
        `, [postId, userId]);
        
        res.json(lists);
    } catch (err) {
        res.status(500).json({ error: "Database error" });
    }
});

// Create a new playlist and immediately add the current post to it
router.post('/playlists/create', async (req, res) => {
    const { name, postId } = req.body;
    const userId = res.userInfo?.id;

    if (!userId || !name) return res.status(400).send("Missing data");

    try {
        const [result] = await db.execute(
            'INSERT INTO playlists (user_id, name) VALUES (?, ?)', 
            [userId, name]
        );
        const newPlaylistId = result.insertId;

        if (postId) {
            await db.execute(
                'INSERT INTO playlist_items (playlist_id, post_id) VALUES (?, ?)', 
                [newPlaylistId, postId]
            );
        }
        res.json({ success: true, playlistId: newPlaylistId });
    } catch (err) {
        res.status(500).send("Error creating playlist");
    }
});

// Add/Remove Toggle Post in Playlist
router.post('/playlists/toggle-item', async (req, res) => {
    const { playlistId, postId } = req.body;
    const userId = res.userInfo?.id;

    try {
        // Security check: Does this user own this playlist?
        const [ownerCheck] = await db.execute(
            'SELECT id FROM playlists WHERE id = ? AND user_id = ?', 
            [playlistId, userId]
        );
        if (ownerCheck.length === 0) return res.status(403).send("Unauthorized");

        // Check if item exists
        const [existing] = await db.execute(
            'SELECT id FROM playlist_items WHERE playlist_id = ? AND post_id = ?',
            [playlistId, postId]
        );

        if (existing.length > 0) {
            await db.execute('DELETE FROM playlist_items WHERE id = ?', [existing[0].id]);
            return res.json({ status: 'removed' });
        } else {
            await db.execute(
                'INSERT INTO playlist_items (playlist_id, post_id) VALUES (?, ?)',
                [playlistId, postId]
            );
            return res.json({ status: 'added' });
        }
    } catch (err) {
        res.status(500).send("Error toggling playlist item");
    }
});

// Rename Playlist
router.post('/playlists/rename', async (req, res) => {
    const { playlistId, newName } = req.body;
    const userId = res.userInfo?.id;

    try {
        await db.execute(
            'UPDATE playlists SET name = ? WHERE id = ? AND user_id = ?',
            [newName, playlistId, userId]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: "Rename failed" });
    }
});

// Toggle Public/Private
router.post('/playlists/toggle-privacy', async (req, res) => {
    const { playlistId } = req.body;
    const userId = res.userInfo?.id;

    try {
        await db.execute(`
            UPDATE playlists 
            SET is_public = NOT is_public 
            WHERE id = ? AND user_id = ?
        `, [playlistId, userId]);
        
        res.json({ success: true });
    } catch (err) {
        res.status(500).send("Error");
    }
});

// Delete Playlist
router.post('/playlists/delete/:id', async (req, res) => {
    const userId = res.userInfo?.id;
    const playlistId = req.params.id;

    try {
        // Only delete if the user owns it
        await db.execute('DELETE FROM playlists WHERE id = ? AND user_id = ?', [playlistId, userId]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: "Failed to delete" });
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
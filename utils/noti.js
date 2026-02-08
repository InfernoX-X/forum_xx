const db = require('../db'); 

/**
 * Creates a notification in the database.
 * @param {number} recipientId - Who receives it
 * @param {number} senderId - Who triggered it
 * @param {string} type - 'comment', 'mention', 'system', 'rank_up', 'fill_request'
 * @param {number|null} postId - Optional link to a post
 * @param {string} message - The text shown to the user
 * @param {string|null} linkUrl - Optional custom URL
 */
async function createNotification(recipientId, senderId, type, postId, message, linkUrl = null) {
    if (recipientId === senderId && type !== 'system') {
        return; 
    }

    try {
        await db.execute(
            `INSERT INTO notifications (recipient_id, sender_id, type, post_id, message, link_url) 
             VALUES (?, ?, ?, ?, ?, ?)`,
            [recipientId, senderId, type, postId, message, linkUrl]
        );
    } catch (err) {
        console.error("Failed to create notification:", err);
    }
}

module.exports = { createNotification };
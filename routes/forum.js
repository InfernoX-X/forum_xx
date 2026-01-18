/////////////////////////////////////////////////// Imports and base setup ///////////////////////////////////////////////////////
const express = require('express');
const router = express.Router();
const db = require('../db');
const multer = require("multer");

const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.API_KEY,
  api_secret: process.env.API_SECRET
});

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

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

// Fetch posts
router.get('/:id', async (req, res) => {
    try {
        // Updated query to fetch multiple categories per post
        const [posts] = await db.execute(`
            SELECT p.*, u.username, 
                   GROUP_CONCAT(f.title) as categories,
                   GROUP_CONCAT(f.id) as forum_ids
            FROM posts p 
            JOIN users u ON p.user_id = u.id 
            LEFT JOIN post_categories pc ON p.id = pc.post_id
            LEFT JOIN forums f ON pc.forum_id = f.id
            WHERE p.deleted = 0
            GROUP BY p.id
            HAVING FIND_IN_SET(?, forum_ids)
            ORDER BY p.created_at DESC`, [req.params.id]);

        let [forumRows] = await db.execute(`SELECT title FROM forums WHERE id = ?`, [req.params.id]);
        const forumTitle = forumRows.length > 0 ? forumRows[0]['title'] : "Forum";
        const [allForums] = await db.execute(`SELECT id, title FROM forums ORDER BY title ASC`);

        res.render('pages/forum', { 
            posts: posts,
            allForums: allForums,
            user: res.userInfo,
            timeAgo: timeAgo,
            forum_id: req.params.id,
            forumTitle
        });
    } catch (err) {
        console.error('Database Error:', err);
        res.redirect("/");
    }
});

router.post('/posts/create', upload.single('image'), async (req, res) => {
    try {
        const { title, content, url, forumIds } = req.body; // forumIds will be an array
        const userId = res.userInfo.id;

        if (!req.file) return res.status(400).send('Image required');

        cloudinary.uploader.upload_stream({ resource_type: 'auto' }, async (error, result) => {
            if (error) return res.status(500).send('Cloudinary Error');

            // 1. Insert into main posts table
            const [postResult] = await db.execute(
                `INSERT INTO posts (title, content, url, image, img_public_id, user_id) VALUES (?, ?, ?, ?, ?, ?)`,
                [title, content || null, url || null, result.secure_url, result.public_id, userId]
            );

            const newPostId = postResult.insertId;

            // 2. Insert into post_categories bridge table
            if (forumIds) {
                const ids = Array.isArray(forumIds) ? forumIds : [forumIds];
                for (const fId of ids) {
                    await db.execute(`INSERT INTO post_categories (post_id, forum_id) VALUES (?, ?)`, [newPostId, fId]);
                }
            }

            // Redirect to the first selected category or 'back'
            res.redirect(`back`);
        }).end(req.file.buffer);

    } catch (err) {
        console.error(err);
        res.status(500).send('Internal Server Error');
    }
});

// Edit Post
router.post('/posts/edit/:id', upload.single('image'), async (req, res) => {
    const postId = req.params.id;
    const { title, content, url, forumIds } = req.body; 
    
    try {
        let newImgLink = null;
        let newPubId = null;

        if (req.file) {
            // ... keep your existing Cloudinary Promise logic here ...
            const result = await uploadToCloudinary();
            newImgLink = result.secure_url;
            newPubId = result.public_id;
        }

        // 1. Update Post Text/Image
        const sql = `
            UPDATE posts 
            SET title = COALESCE(NULLIF(?, ''), title), 
                content = ?, 
                url = ?,
                image = COALESCE(?, image),
                img_public_id = COALESCE(?, img_public_id)
            WHERE id = ?`;
        await db.execute(sql, [title, content, url, newImgLink, newPubId, postId]);

        // 2. Update Categories (Bridge Table)
        if (forumIds) {
            // Remove old links
            await db.execute(`DELETE FROM post_categories WHERE post_id = ?`, [postId]);
            
            // Add new links
            const ids = Array.isArray(forumIds) ? forumIds : [forumIds];
            for (const fId of ids) {
                await db.execute(`INSERT INTO post_categories (post_id, forum_id) VALUES (?, ?)`, [postId, fId]);
            }
        }

        res.redirect('back');
    } catch (err) {
        console.error(err);
        res.status(500).send('Update failed');
    }
});


// Delete Post
router.post('/posts/delete/:postId', async (req, res) => {
    try {
        const postId = req.params.postId;
        const userId = res.userInfo.id; // Get ID of the logged-in user
        const forumId = req.body.forum_id; // Pass this from the hidden input to redirect back

        // We check BOTH the post id and the user_id for security
        const [result] = await db.execute(
            `UPDATE posts SET deleted = ? WHERE id = ? AND user_id = ?`,
            [1, postId, userId]
        );

        if (result.affectedRows === 0) {
            return res.status(403).send("You don't have permission to delete this or the post doesn't exist.");
        }

        // Redirect back to the forum they were just on
        res.redirect(`/forum/${forumId}`);

    } catch (err) {
        console.error('Error deleting post:', err);
        res.status(500).send('Could not delete post.');
    }
});


module.exports = router;
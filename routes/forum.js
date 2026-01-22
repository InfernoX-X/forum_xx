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

// View Video
router.get('/post/:id', async (req, res) => {
    try{
        const postId = req.params.id;

        const [rows] = await db.execute(`
            SELECT 
                p.*, 
                u.username,
                GROUP_CONCAT(f.title) AS categories,
                GROUP_CONCAT(f.id) AS forum_ids
            FROM posts p
            JOIN users u ON p.user_id = u.id
            LEFT JOIN post_categories pc ON p.id = pc.post_id
            LEFT JOIN forums f ON pc.forum_id = f.id
            WHERE p.id = ?
            GROUP BY p.id
        `, [postId]);

        if (rows.length === 0) {
            return res.status(404).send('Post not found');
        }

        const post = rows[0];

        res.render('pages/post', { 
            post,
            user: res.userInfo,
            timeAgo
        });

    } catch (err) {
        console.error("Error fetching single post:", err);
        res.status(500).send('Internal Server Error');
    }
});

// New Video
router.post('/posts/create', upload.single('image'), async (req, res) => {
    try {
        const { title, content, url, forumIds } = req.body;
        const userId = res.userInfo.id;

        let imageUrl = null;
        let imagePublicId = null;

        // 1. Check if a file exists. If so, upload to Cloudinary
        if (req.file) {
            const uploadResult = await new Promise((resolve, reject) => {
                const stream = cloudinary.uploader.upload_stream(
                    { resource_type: 'auto' },
                    (error, result) => {
                        if (error) reject(error);
                        else resolve(result);
                    }
                );
                stream.end(req.file.buffer);
            });
            
            imageUrl = uploadResult.secure_url;
            imagePublicId = uploadResult.public_id;
        }

        // 2. Insert into main posts table (image fields will be null if no file)
        const [postResult] = await db.execute(
            `INSERT INTO posts (title, content, url, image, img_public_id, user_id) VALUES (?, ?, ?, ?, ?, ?)`,
            [title, content || null, url || null, imageUrl, imagePublicId, userId]
        );
        const newPostId = postResult.insertId;
        
        // 3. Insert into post_categories bridge table
        if (forumIds) {
            const ids = Array.isArray(forumIds) ? forumIds : [forumIds];
            for (const fId of ids) {
                await db.execute(`INSERT INTO post_categories (post_id, forum_id) VALUES (?, ?)`, [newPostId, fId]);
            }
        }

        res.redirect(`back`);

    } catch (err) {
        console.error("Error creating post:", err);
        res.status(500).send('Internal Server Error');
    }
});

// Edit Video
router.post('/posts/edit/:id', upload.single('image'), async (req, res) => {
    const postId = req.params.id;
    const { title, content, url, forumIds } = req.body; 
    
    try {
        let newImgLink = null;
        let newPubId = null;

        if (req.file) {
            const result = await new Promise((resolve, reject) => {
                const stream = cloudinary.uploader.upload_stream(
                    { resource_type: 'auto' },
                    (error, result) => {
                        if (error) reject(error);
                        else resolve(result);
                    }
                );
                stream.end(req.file.buffer);
            });

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

// Delete Video
// router.post('/posts/delete/:postId', async (req, res) => {
//     try {
//         const postId = req.params.postId;
//         const userId = res.userInfo.id; // Get ID of the logged-in user
//         const forumId = req.body.forum_id; // Pass this from the hidden input to redirect back

//         // We check BOTH the post id and the user_id for security
//         const [result] = await db.execute(
//             `UPDATE posts SET deleted = ? WHERE id = ? AND user_id = ?`,
//             [1, postId, userId]
//         );

//         if (result.affectedRows === 0) {
//             return res.status(403).send("You don't have permission to delete this or the post doesn't exist.");
//         }

//         // Redirect back to the forum they were just on
//         res.redirect(`/forum/${forumId}`);

//     } catch (err) {
//         console.error('Error deleting post:', err);
//         res.status(500).send('Could not delete post.');
//     }
// });


module.exports = router;
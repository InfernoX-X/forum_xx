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


router.get('/:id', async (req, res) => {
    try {
        // 1. Fetch posts for this forum
        const [posts] = await db.execute(`
            SELECT p.id, p.user_id, p.forum_id, p.title, p.content, p.url, p.image, p.created_at, p.deleted, u.username 
            FROM posts p 
            JOIN users u ON p.user_id = u.id 
            WHERE p.forum_id = ? AND p.deleted = ? 
            ORDER BY p.created_at DESC`, [req.params.id, 0]);

        // 2. Fetch the current forum title
        let [forumRows] = await db.execute(`SELECT title FROM forums WHERE id = ?`, [req.params.id]);
        const forumTitle = forumRows.length > 0 ? forumRows[0]['title'] : "Forum";

        // 3. NEW: Fetch ALL forums so the edit dropdown has a list of categories
        const [allForums] = await db.execute(`SELECT id, title FROM forums ORDER BY title DESC`);

        res.render('pages/forum', { 
            posts: posts,
            allForums: allForums, // Pass this to the frontend
            user: res.userInfo,
            timeAgo: timeAgo,
            forum_id: req.params.id,
            forumTitle
        });
    } catch (err) {
        console.error('Database Error on fetch forum data:', err);
        res.redirect("/");
    }
});

router.post('/posts/create', upload.single('image'), async (req, res) => {
    try {
        const { title, content, url, forumId } = req.body;
        const userId = res.userInfo.id; // Assuming res.userInfo contains the logged-in user
        let pub_id;
        let imglink;

        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }
        cloudinary.uploader.upload_stream({ resource_type: 'auto' }, async (error, result) => {
            if (error) {
            console.log(error);
            return res.status(500).json({ error: 'Error uploading to Cloudinary' });
            }
            pub_id = result.public_id;
            imglink = result.secure_url;

            // Basic validation
            if (!title || !forumId) {
                return res.status(400).send('Title and Forum ID are required.');
            }
    
            await db.execute(
                `INSERT INTO posts (title, content, url, image,img_public_id, forum_id, user_id) 
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [title, content || null, url || null, imglink, pub_id, forumId, userId]
            );
    
            // Redirect back to the forum page
            res.redirect(`/forum/${forumId}`);

        }).end(req.file.buffer);

    } catch (err) {
        console.error('Error creating post:', err);

        if(err.code == "ER_DATA_TOO_LONG"){
            res.status(500).send('Text Too Long...');
        }
        
        res.status(500).send('Internal Server Error');
    }
});




router.post('/posts/edit/:id', upload.single('image'), async (req, res) => {
    const postId = req.params.id;
    // Added forum_id here (this comes from the <select name="forum_id">)
    const { title, content, url, forum_id } = req.body; 
    
    try {
        let newImgLink = null;
        let newPubId = null;

        if (req.file) {
            const uploadToCloudinary = () => {
                return new Promise((resolve, reject) => {
                    const stream = cloudinary.uploader.upload_stream(
                        { resource_type: 'auto' },
                        (error, result) => { result ? resolve(result) : reject(error); }
                    );
                    stream.end(req.file.buffer);
                });
            };
            const result = await uploadToCloudinary();
            newImgLink = result.secure_url;
            newPubId = result.public_id;
        }

        // Updated SQL to include forum_id
        const sql = `
            UPDATE posts 
            SET title = COALESCE(NULLIF(?, ''), title), 
                content = COALESCE(NULLIF(?, ''), content), 
                url = COALESCE(NULLIF(?, ''), url),
                forum_id = COALESCE(NULLIF(?, ''), forum_id),
                image = COALESCE(?, image),
                img_public_id = COALESCE(?, img_public_id)
            WHERE id = ?`;

        // Added forum_id to the parameters array
        await db.execute(sql, [title, content, url, forum_id, newImgLink, newPubId, postId]);

        res.redirect('back');
        
    } catch (err) {
        console.error('Update Error:', err);
        res.status(500).send('Failed to update post');
    }
});

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
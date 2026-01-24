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

// VIEW SINGLE POST
router.get('/post/:id', async (req, res) => {
    try {
        const postId = req.params.id;

        // 1. Fetch Post Data
        const [rows] = await db.execute(`
            SELECT p.*, u.username,u.id as userId, 
                   GROUP_CONCAT(f.title) AS categories,
                   GROUP_CONCAT(DISTINCT f.id) AS forum_id_list
            FROM posts p
            JOIN users u ON p.user_id = u.id
            LEFT JOIN post_categories pc ON p.id = pc.post_id
            LEFT JOIN forums f ON pc.forum_id = f.id
            WHERE p.id = ?
            GROUP BY p.id
        `, [postId]);

        if (rows.length === 0) return res.status(404).send('Post not found');
        const post = rows[0];

        // 2. Fetch Images & Comments  
        const [images] = await db.execute(`SELECT * FROM post_images WHERE post_id = ?`, [postId]);
        const [comments] = await db.execute(`
            SELECT c.*, u.username FROM comments c 
            JOIN users u ON c.user_id = u.id 
            WHERE c.post_id = ? ORDER BY c.created_at DESC
        `, [postId]);

        // We look for posts that share the same forum_ids, excluding the current post
        const forumIds = post.forum_id_list ? post.forum_id_list.split(',') : [];
        
        let recommended = [];
        if (forumIds.length > 0) {
            [recommended] = await db.query(`
                SELECT p.id, p.title, p.created_at, 
                    COUNT(pc.forum_id) AS shared_tag_count,
                    (SELECT image_url FROM post_images WHERE post_id = p.id LIMIT 1) as thumb
                FROM posts p
                JOIN post_categories pc ON p.id = pc.post_id
                WHERE pc.forum_id IN (?) AND p.id != ?
                GROUP BY p.id
                ORDER BY shared_tag_count DESC, p.created_at DESC
                LIMIT 8
            `, [forumIds, postId]);
        }

        res.render('pages/post', { 
            post, images, comments, recommended,
            user: res.userInfo,
            timeAgo
        });

    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
});

// SUBMIT A COMMENT
router.post('/post/:id/comment', async (req, res) => {
    try {
        const postId = req.params.id;
        const { comment } = req.body;
        const userId = res.userInfo.id; // Assuming res.userInfo contains the logged-in user

        if (!comment || comment.trim() === "") {
            return res.redirect('back');
        }

        await db.execute(
            `INSERT INTO comments (post_id, user_id, content) VALUES (?, ?, ?)`,
            [postId, userId, comment.trim()]
        );

        res.redirect('back'); // Refresh the page to show the new comment
    } catch (err) {
        console.error("Error saving comment:", err);
        res.status(500).send('Failed to post comment');
    }
});

// CREATE NEW
router.post('/posts/create', upload.array('images', 5), async (req, res) => {
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        const { title, content, url, forumIds, remoteUrls } = req.body;
        const userId = res.userInfo.id;

        // 1. Create the main post row
        const [postResult] = await connection.execute(
            `INSERT INTO posts (title, content, url, user_id) VALUES (?, ?, ?, ?)`,
            [title, content || null, url || null, userId]
        );
        const newPostId = postResult.insertId;

        // 2. Prepare all image sources (Files + URLs)
        let imageSources = [];

        // Add physical file buffers
        if (req.files && req.files.length > 0) {
            req.files.forEach(file => imageSources.push({ type: 'file', data: file.buffer }));
        }

        // Add pasted URLs (split by newline or space)
        if (remoteUrls) {
            const urls = remoteUrls.split(/[\s\n,]+/).filter(u => u.trim().startsWith('http'));
            urls.forEach(u => imageSources.push({ type: 'url', data: u.trim() }));
        }

        // Enforce 5 image limit
        const finalImages = imageSources.slice(0, 5);

        // 3. Upload to Cloudinary and Save to DB
        for (const img of finalImages) {
            let uploadPromise;

            if (img.type === 'file') {
                uploadPromise = new Promise((resolve, reject) => {
                    const stream = cloudinary.uploader.upload_stream(
                        { resource_type: 'auto', folder: 'user_posts' },
                        (error, result) => error ? reject(error) : resolve(result)
                    );
                    stream.end(img.data);
                });
            } else {
                // Cloudinary can upload directly from a URL
                uploadPromise = cloudinary.uploader.upload(img.data, {
                    resource_type: 'auto',
                    folder: 'user_posts'
                });
            }

            const result = await uploadPromise;

            await connection.execute(
                `INSERT INTO post_images (post_id, image_url, img_public_id) VALUES (?, ?, ?)`,
                [newPostId, result.secure_url, result.public_id]
            );
        }

        // 4. Handle Categories
        if (forumIds) {
            const ids = Array.isArray(forumIds) ? forumIds : [forumIds];
            for (const fId of ids) {
                await connection.execute(
                    `INSERT INTO post_categories (post_id, forum_id) VALUES (?, ?)`, 
                    [newPostId, fId]
                );
            }
        }

        await connection.commit();
        res.redirect('back');

    } catch (err) {
        await connection.rollback();
        console.error("Critical error during post creation:", err);
        res.status(500).send('Internal Server Error');
    } finally {
        connection.release();
    }
});

// Edit Photos
router.post('/posts/edit-image/:imageId', upload.single('image'), async (req, res) => {
    const { imageId } = req.params;
    const userId = res.userInfo.id;

    if (!req.file) return res.status(400).send('No image provided');

    try {
        const [imgData] = await db.execute(`
            SELECT pi.img_public_id, p.user_id 
            FROM post_images pi
            JOIN posts p ON pi.post_id = p.id
            WHERE pi.id = ?`, [imageId]);

        if (imgData.length === 0) return res.status(404).send('Image not found');
        if (imgData[0].user_id !== userId) return res.status(403).send('Unauthorized');

        // 1. Upload NEW image first
        const result = await new Promise((resolve, reject) => {
            const stream = cloudinary.uploader.upload_stream(
                { resource_type: 'auto', folder: 'user_posts' },
                (error, res) => (error ? reject(error) : resolve(res))
            );
            stream.end(req.file.buffer);
        });

        // 2. Update DB
        await db.execute(
            `UPDATE post_images SET image_url = ?, img_public_id = ? WHERE id = ?`,
            [result.secure_url, result.public_id, imageId]
        );

        // 3. ONLY THEN delete old image from Cloudinary
        if (imgData[0].img_public_id) {
            await cloudinary.uploader.destroy(imgData[0].img_public_id);
        }

        res.redirect('back');
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to replace image');
    }
});

// Adding Photo
router.post('/posts/add-images/:id', upload.array('images', 5), async (req, res) => {
    const postId = req.params.id;
    const userId = res.userInfo.id;
    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();

        // 1. Verify ownership
        const [post] = await connection.execute(
            `SELECT user_id FROM posts WHERE id = ?`, 
            [postId]
        );

        if (post.length === 0 || post[0].user_id !== userId) {
            await connection.rollback();
            return res.status(403).send('Unauthorized or Post not found');
        }

        // 2. Count existing images
        const [currentRows] = await connection.execute(
            `SELECT COUNT(*) as count FROM post_images WHERE post_id = ?`, 
            [postId]
        );
        const existingCount = currentRows[0].count;
        const slotsAvailable = 5 - existingCount;

        // 3. Validation
        if (slotsAvailable <= 0) {
            await connection.rollback();
            return res.status(400).send('Limit reached: You already have 5 images.');
        }

        if (!req.files || req.files.length === 0) {
            await connection.rollback();
            return res.status(400).send('No images selected.');
        }

        // 4. Only take the number of files that fit in the remaining slots
        const filesToUpload = req.files.slice(0, slotsAvailable);

        // 5. Upload loop
        for (const file of filesToUpload) {
            const result = await new Promise((resolve, reject) => {
                const stream = cloudinary.uploader.upload_stream(
                    { resource_type: 'auto', folder: 'user_posts' },
                    (error, result) => error ? reject(error) : resolve(result)
                );
                stream.end(file.buffer);
            });

            await connection.execute(
                `INSERT INTO post_images (post_id, image_url, img_public_id) VALUES (?, ?, ?)`,
                [postId, result.secure_url, result.public_id]
            );
        }

        await connection.commit();
        res.redirect('back');

    } catch (err) {
        if (connection) await connection.rollback();
        console.error("Upload error:", err);
        res.status(500).send('Server Error');
    } finally {
        if (connection) connection.release();
    }
});

// Edit POST
router.post('/posts/edit/:id', async (req, res) => {
    const postId = req.params.id;
    const { title, content, url, forumIds } = req.body;
    const userId = res.userInfo.id;
    const conn = await db.getConnection(); // Get connection for transaction

    try {
        await conn.beginTransaction();

        const [post] = await conn.execute(`SELECT user_id FROM posts WHERE id = ?`, [postId]);
        if (post.length === 0 || post[0].user_id !== userId) {
            await conn.rollback();
            return res.status(403).send('Unauthorized');
        }

        // Update Text
        await conn.execute(`
            UPDATE posts 
            SET title = COALESCE(NULLIF(?, ''), title), content = ?, url = ?
            WHERE id = ?`, [title, content, url, postId]);

        // Update Categories (Sync approach)
        if (forumIds) {
            await conn.execute(`DELETE FROM post_categories WHERE post_id = ?`, [postId]);
            const ids = Array.isArray(forumIds) ? forumIds : [forumIds];
            
            // Bulk Insert optimized
            if (ids.length > 0) {
                const values = ids.map(fId => [postId, fId]);
                await conn.query(`INSERT INTO post_categories (post_id, forum_id) VALUES ?`, [values]);
            }
        }

        await conn.commit();
        res.redirect('back');
    } catch (err) {
        await conn.rollback();
        console.error(err);
        res.status(500).send('Update failed');
    } finally {
        conn.release();
    }
});

module.exports = router;    


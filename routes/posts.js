/////////////////////////////////////////////////// Imports and base setup ///////////////////////////////////////////////////////
const express = require('express');
const router = express.Router();
const db = require('../db.js');
const multer = require("multer");
const sharp = require('sharp');
const { createNotification } = require('../utils/noti.js');

async function compressImage(buffer) {
    const originalSize = buffer.length;

    // Use sharp to process the image
    const processed = sharp(buffer)
        .rotate() // Automatically rotates the image based on EXIF data (fixes sideways phone pics)
        .resize({
            width: 1600,
            height: 1600,
            fit: 'inside',          // Maintain aspect ratio, don't crop
            withoutEnlargement: true // Don't upscale small images
        })
        .jpeg({ 
            quality: 80, 
            mozjpeg: true,
            progressive: true 
        });

    const compressedBuffer = await processed.toBuffer();

    return compressedBuffer.length < originalSize ? compressedBuffer : buffer;
}

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
        const currentUserId = res.userInfo ? res.userInfo.id : 0;

        const excludeHeaders = ['channel', 'Age', 'Ethnicity', 'Orientation', 'Level'];
        const excludeTags = ['Solo / 1 Person', 'Duo / 2 People', 'Indoor', 'Pussy', 'Ass', 'Tits', 'Consensual / Willing', 'Black Hair', 'Brunette'];

        // 1. Fetch Post Data
        const [rows] = await db.execute(`
            SELECT p.*, u.username, u.id as userId, 
                GROUP_CONCAT(DISTINCT f.title) AS categories,
                GROUP_CONCAT(DISTINCT CASE 
                        WHEN f.header NOT IN (${excludeHeaders.map(() => '?').join(',')}) 
                        AND f.title NOT IN (${excludeTags.map(() => '?').join(',')}) 
                        THEN f.id 
                        ELSE NULL 
                END) AS valid_recommendation_ids,
                (SELECT COUNT(*) FROM post_votes WHERE post_id = p.id AND vote_type = 1) as upvotes,
                (SELECT COUNT(*) FROM post_votes WHERE post_id = p.id AND vote_type = -1) as downvotes,
                -- THIS ? must match currentUserId in the array below
                (SELECT vote_type FROM post_votes WHERE post_id = p.id AND user_id = ? LIMIT 1) as userVote
            FROM posts p
            JOIN users u ON p.user_id = u.id
            LEFT JOIN post_categories pc ON p.id = pc.post_id
            LEFT JOIN forums f ON pc.forum_id = f.id
            WHERE p.id = ? AND p.deleted = 0
            GROUP BY p.id
        `, [...excludeHeaders, ...excludeTags, currentUserId, postId]);  

        if (rows.length === 0) return res.redirect("/");
        const post = rows[0];

        // 2. Recommendations with Personalized Filter
        const validIds = post.valid_recommendation_ids ? post.valid_recommendation_ids.split(',') : [];
        let recommended = [];

        if (validIds.length > 0) {
            [recommended] = await db.query(`
                SELECT p.id, p.title, p.created_at, 
                    COUNT(pc.forum_id) AS shared_tag_count,
                    COALESCE((SELECT SUM(vote_type) FROM post_votes WHERE post_id = p.id), 0) as net_score,
                    (SELECT image_url FROM post_images WHERE post_id = p.id LIMIT 1) as thumb
                FROM posts p
                JOIN post_categories pc ON p.id = pc.post_id
                
                LEFT JOIN post_votes pv_filter ON p.id = pv_filter.post_id 
                    AND pv_filter.user_id = ? 
                    AND pv_filter.vote_type = -1

                WHERE pc.forum_id IN (?) 
                AND p.id != ? 
                AND p.deleted = 0
                AND pv_filter.post_id IS NULL
                
                GROUP BY p.id
                ORDER BY shared_tag_count DESC, net_score DESC
                LIMIT 8
            `, [Number(currentUserId), validIds, postId]); 
        }

        // 3. Fetch Images & Comments 
        const [images] = await db.execute(`SELECT * FROM post_images WHERE post_id = ?`, [postId]);
        const [comments] = await db.execute(`
            SELECT c.*, u.username, u.id as userId FROM comments c 
            JOIN users u ON c.user_id = u.id 
            WHERE c.post_id = ? ORDER BY c.created_at DESC
        `, [postId]);

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
        const senderId = res.userInfo.id; 

        if (!comment || comment.trim() === "") {
            return res.redirect('back');
        }

        await db.execute(
            `INSERT INTO comments (post_id, user_id, content) VALUES (?, ?, ?)`,
            [postId, senderId, comment.trim()]
        );
        
        // 2. Find the recipient (the person who wrote the post)
        const [post] = await db.execute(
            `SELECT user_id FROM posts WHERE id = ?`, 
            [postId]
        );

        if (post.length > 0) {
            const recipientId = post[0].user_id;

            const msg = `${res.userInfo.username}: commented on your post "${comment.substring(0, 12)}..."`;
            await createNotification(recipientId, senderId, 'comment', postId, msg);
        }

        res.redirect('back');
    } catch (err) {
        console.error("Error saving comment:", err);
        res.status(500).send('Failed to post comment');
    }
});

// CREATE NEW POST
router.post('/posts/create', upload.array('images', 5), async (req, res) => {
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        const { title, content, url, forumIds, remoteUrls, draft } = req.body;
        const userId = res.userInfo.id;

        let draftValue = draft || 0; 

        // 1. Create the main post row
        const [postResult] = await connection.execute(
            `INSERT INTO posts (title, content, url, deleted, user_id) VALUES (?, ?, ?, ?, ?)`,
            [title, content || null, url || null, draftValue, userId]
        );
        const newPostId = postResult.insertId;

        // 2. Prepare all image sources (Files + URLs)
        let imageSources = [];

        // Add physical file buffers
        if (req.files && req.files.length > 0) {
            for (const file of req.files) {
                const compressed = await compressImage(file.buffer);
                imageSources.push({ type: 'file', data: compressed });
            }
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
                        { resource_type: 'auto', folder: 'user_posts', cache_control: 'public, max-age=31536000, immutable'},
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

// Edit PHOTOS
router.post('/posts/edit-image/:imageId', upload.single('image'), async (req, res) => {
    const { imageId } = req.params;
    const userId = res.userInfo.id;
    const isAdmin = res.userInfo.isAdmin === 1;

    if (!req.file) return res.status(400).send('No image provided');

    try {
        const [imgData] = await db.execute(`
            SELECT pi.img_public_id, p.user_id 
            FROM post_images pi
            JOIN posts p ON pi.post_id = p.id
            WHERE pi.id = ?`, [imageId]);

        if (imgData.length === 0) return res.status(404).send('Image not found');
        if (imgData[0].user_id !== userId && !isAdmin) {
            return res.status(403).send('Unauthorized');
        }
        const compressedBuffer = await compressImage(req.file.buffer);

        // 1. Upload NEW image first
        const result = await new Promise((resolve, reject) => {
            const stream = cloudinary.uploader.upload_stream(
                { resource_type: 'auto', folder: 'user_posts' , cache_control: 'public, max-age=31536000, immutable'},
                (error, res) => (error ? reject(error) : resolve(res))
            );
            stream.end(compressedBuffer);
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

// ADD PHOTOS
router.post('/posts/add-images/:id', upload.array('images', 5), async (req, res) => {
    const postId = req.params.id;
    const userId = res.userInfo.id;
    const isAdmin = res.userInfo.isAdmin === 1; // Check admin status
    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();

        // 1. Verify ownership
        const [post] = await connection.execute(
            `SELECT user_id FROM posts WHERE id = ?`, 
            [postId]
        );

        if (post.length === 0 || (post[0].user_id !== userId && !isAdmin)) {
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
            const compressedBuffer = await compressImage(file.buffer);

            const result = await new Promise((resolve, reject) => {
                const stream = cloudinary.uploader.upload_stream(
                    { resource_type: 'auto', folder: 'user_posts', cache_control: 'public, max-age=31536000, immutable' },
                    (error, result) => error ? reject(error) : resolve(result)
                );
                stream.end(compressedBuffer);
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

// EDIT POST
router.post('/posts/edit/:id', async (req, res) => {
    const postId = req.params.id;
    const { title, content, url, forumIds, draft } = req.body;
    const userId = res.userInfo.id;
    const isAdmin = res.userInfo.isAdmin === 1; // Check admin status
    const conn = await db.getConnection(); // Get connection for transaction

    let draftValue = draft || 0; 

    try {
        await conn.beginTransaction();

        const [post] = await conn.execute(`SELECT user_id FROM posts WHERE id = ?`, [postId]);

        // UPDATED: Allow if owner OR admin
        if (post.length === 0 || (post[0].user_id !== userId && !isAdmin)) {
            await conn.rollback();
            return res.status(403).send('Unauthorized');
        }

        // Update Text
        await conn.execute(`
            UPDATE posts 
            SET 
                title = COALESCE(NULLIF(?, ''), title), 
                content = ?, 
                url = ?, 
                created_at = CASE WHEN deleted = 1 AND ? = 0 THEN CURRENT_TIMESTAMP ELSE created_at END,
                deleted = ?
            WHERE id = ?`, 
            [title, content, url, draftValue, draftValue, postId]
        );

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

// VOTE POST
router.post('/posts/vote', async (req, res) => {
    const { postId, voteType } = req.body; // voteType is 1 or -1
    const userId = res.userInfo.id; 
    
    if (![1, -1].includes(Number(voteType))) {
        return res.status(400).json({ error: "Invalid vote type" });
    }

    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        // 1. Check if user already voted
        const [existing] = await connection.execute(
            'SELECT vote_type FROM post_votes WHERE user_id = ? AND post_id = ?',
            [userId, postId]
        );

        let message = "";

        if (existing.length > 0) {
            if (existing[0].vote_type === Number(voteType)) {
                // Same button clicked again -> Remove vote
                await connection.execute(
                    'DELETE FROM post_votes WHERE user_id = ? AND post_id = ?',
                    [userId, postId]
                );
                message = "Vote removed";
            } else {
                // Opposite button clicked -> Switch vote
                await connection.execute(
                    'UPDATE post_votes SET vote_type = ? WHERE user_id = ? AND post_id = ?',
                    [voteType, userId, postId]
                );
                message = "Vote updated";
            }
        } else {
            // New vote
            await connection.execute(
                'INSERT INTO post_votes (user_id, post_id, vote_type) VALUES (?, ?, ?)',
                [userId, postId, voteType]
            );
            message = "Vote recorded";
        }

        // 2. Get the updated net score to send back to UI
        const [counts] = await connection.execute(`
            SELECT 
                (SELECT COUNT(*) FROM post_votes WHERE post_id = ? AND vote_type = 1) as upvotes,
                (SELECT COUNT(*) FROM post_votes WHERE post_id = ? AND vote_type = -1) as downvotes
        `, [postId, postId]);

        await connection.commit();
        
        res.json({ 
            message, 
            upvotes: counts[0].upvotes, 
            downvotes: counts[0].downvotes
        });

    } catch (err) {
        await connection.rollback();
        console.error("Voting error:", err);
        res.status(500).json({ error: "Internal Server Error" });
    } finally {
        connection.release();
    }
});


module.exports = router;    


const express = require('express');
const router = express.Router();
const db = require('../db');
const { createNotification } = require('../utils/noti.js');


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

// Index Page
router.get('/', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 15;
        const offset = (page - 1) * limit;

        const currentUserId = res.userInfo ? res.userInfo.id : 0;

        const [countResult] = await db.execute('SELECT COUNT(*) as total FROM posts WHERE deleted = 0');
        const totalPosts = countResult[0].total;
        const totalPages = Math.ceil(totalPosts / limit);

        const [posts] = await db.execute(`
            SELECT p.*, u.username, u.id as userId, 
                GROUP_CONCAT(DISTINCT f.title) as categories,
                GROUP_CONCAT(DISTINCT f.id) as forum_ids,

                (SELECT COUNT(*) FROM post_votes WHERE post_id = p.id AND vote_type = 1) as upvotes,
                (SELECT COUNT(*) FROM post_votes WHERE post_id = p.id AND vote_type = -1) as downvotes,
                (SELECT vote_type FROM post_votes WHERE post_id = p.id AND user_id = ? LIMIT 1) as userVote,
                
                (SELECT GROUP_CONCAT(image_url ORDER BY id ASC) FROM post_images WHERE post_id = p.id) as all_images,
                (SELECT GROUP_CONCAT(id ORDER BY id ASC) FROM post_images WHERE post_id = p.id) as image_ids,
                (SELECT image_url FROM post_images WHERE post_id = p.id ORDER BY id ASC LIMIT 1) as thumbnail,
                (SELECT COUNT(*) FROM post_images WHERE post_id = p.id) as image_count
            FROM posts p 
            JOIN users u ON p.user_id = u.id 
            LEFT JOIN post_categories pc ON p.id = pc.post_id
            LEFT JOIN forums f ON pc.forum_id = f.id
            WHERE p.deleted = 0
            GROUP BY p.id
            ORDER BY p.created_at DESC
            LIMIT ? OFFSET ?`, 
            [currentUserId, limit.toString(), offset.toString()] // Pass currentUserId first
        );
            
        const [allForums] = await db.execute(`SELECT id, title, header, order_by FROM forums ORDER BY header ASC, order_by ASC, title ASC`);

        res.render('index', { 
            posts,
            allForums,
            user: res.userInfo,
            timeAgo,
            currentPage: page,
            totalPages,
            forumTitle: "Home"
        });
    } catch (err) {
        console.error('Database Error:', err);
        res.redirect("/");
    }
});

// View User Page 
router.get('/user/:id', async (req, res) => {
    try {
        const userId = req.params.id;
        const page = parseInt(req.query.page) || 1;
        const limit = 15;
        const offset = (page - 1) * limit;
        const currentUserId = res.userInfo ? res.userInfo.id : 0;

        const [countResult] = await db.execute(
            'SELECT COUNT(*) as total FROM posts WHERE user_id = ? AND deleted = 0', 
            [userId]
        );
        const totalPosts = countResult[0].total;
        const totalPages = Math.ceil(totalPosts / limit);

        const [posts] = await db.execute(`
            SELECT p.*, u.username, u.id as userId, 
                GROUP_CONCAT(DISTINCT f.title) as categories,
                GROUP_CONCAT(DISTINCT f.id) as forum_ids,
                -- Voting Subqueries
                (SELECT COUNT(*) FROM post_votes WHERE post_id = p.id AND vote_type = 1) as upvotes,
                (SELECT COUNT(*) FROM post_votes WHERE post_id = p.id AND vote_type = -1) as downvotes,
                (SELECT vote_type FROM post_votes WHERE post_id = p.id AND user_id = ? LIMIT 1) as userVote,
                
                (SELECT GROUP_CONCAT(image_url ORDER BY id ASC) FROM post_images WHERE post_id = p.id) as all_images,
                (SELECT GROUP_CONCAT(id ORDER BY id ASC) FROM post_images WHERE post_id = p.id) as image_ids,
                (SELECT image_url FROM post_images WHERE post_id = p.id ORDER BY id ASC LIMIT 1) as thumbnail,
                (SELECT COUNT(*) FROM post_images WHERE post_id = p.id) as image_count
            FROM posts p 
            JOIN users u ON p.user_id = u.id 
            LEFT JOIN post_categories pc ON p.id = pc.post_id
            LEFT JOIN forums f ON pc.forum_id = f.id
            WHERE p.user_id = ? AND p.deleted = 0
            GROUP BY p.id
            ORDER BY p.created_at DESC
            LIMIT ? OFFSET ?`, 
            [currentUserId, userId, limit.toString(), offset.toString()] // currentUserId first for the subquery
        );
            
        const [allForums] = await db.execute(`SELECT id, title, header FROM forums ORDER BY header DESC, order_by ASC, title ASC`);

        const profileUsername = posts.length > 0 ? posts[0].username : "User";

        res.render('pages/user', { 
            posts,
            allForums,
            user: res.userInfo,
            timeAgo,
            currentPage: page,
            totalPages,
            forumTitle: `${profileUsername}'s Posts`,
            siteTitle: "ForumX"
        });
    } catch (err) {
        console.error('Database Error:', err);
        res.redirect("/");
    }
});

// Get Drafts (only admins)
router.get('/drafts', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 15;
        const offset = (page - 1) * limit;
        const isAdmin = res.userInfo.isAdmin === 1; 
        const currentUserId = res.userInfo ? res.userInfo.id : 0;
        
        if (!isAdmin) {
            return res.redirect('/');
        }

        const [countResult] = await db.execute(
            'SELECT COUNT(*) as total FROM posts WHERE deleted = 1', 
        );

        const totalPosts = countResult[0].total;
        const totalPages = Math.ceil(totalPosts / limit);

        const [posts] = await db.execute(`
            SELECT p.*, u.username, 
            GROUP_CONCAT(DISTINCT f.title) as categories,
            GROUP_CONCAT(DISTINCT f.id) as forum_ids,
                -- Voting Subqueries
            (SELECT COUNT(*) FROM post_votes WHERE post_id = p.id AND vote_type = 1) as upvotes,
            (SELECT COUNT(*) FROM post_votes WHERE post_id = p.id AND vote_type = -1) as downvotes,
            (SELECT vote_type FROM post_votes WHERE post_id = p.id AND user_id = ? LIMIT 1) as userVote,
            
            (SELECT GROUP_CONCAT(image_url ORDER BY id ASC) FROM post_images WHERE post_id = p.id) as all_images,
            (SELECT GROUP_CONCAT(id ORDER BY id ASC) FROM post_images WHERE post_id = p.id) as image_ids,
            (SELECT image_url FROM post_images WHERE post_id = p.id ORDER BY id ASC LIMIT 1) as thumbnail,
            (SELECT COUNT(*) FROM post_images WHERE post_id = p.id) as image_count
        FROM posts p 
        JOIN users u ON p.user_id = u.id 
        LEFT JOIN post_categories pc ON p.id = pc.post_id
        LEFT JOIN forums f ON pc.forum_id = f.id
        WHERE p.deleted = 1  
        GROUP BY p.id
        ORDER BY p.created_at DESC
        LIMIT ? OFFSET ?`, [currentUserId, limit.toString(), offset.toString()]);
            
        const [allForums] = await db.execute(`SELECT id, title, header, order_by FROM forums ORDER BY title ASC, order_by ASC`);

        res.render('pages/drafts', { 
            posts,
            allForums,
            user: res.userInfo,
            timeAgo,
            currentPage: page,
            totalPages,
            siteTitle: "ForumX"
        });
    } catch (err) {
        console.error('Database Error:', err);
        res.redirect("/");
    }
});

// Search Page
router.get('/search', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 15;
        const offset = (page - 1) * limit;
        const currentUserId = res.userInfo ? res.userInfo.id : 0;

        const searchTerm = req.query.q || '';
        const searchMode = req.query.mode === 'all' ? 'all' : 'any';

        let scope = req.query.scope || ['title', 'content'];
        if (!Array.isArray(scope)) scope = [scope];

        let forumIds = req.query.forums || [];
        if (!Array.isArray(forumIds) && forumIds !== '') forumIds = [forumIds];

        let scopeClauses = [];
        let queryParams = [];

        if (searchTerm) {
            if (scope.includes('title')) {
                scopeClauses.push('p.title LIKE ?');
                queryParams.push(`%${searchTerm}%`);
            }
            if (scope.includes('content')) {
                scopeClauses.push('p.content LIKE ?');
                queryParams.push(`%${searchTerm}%`);
            }
        }
        let whereClause = 'p.deleted = 0';
        if (scopeClauses.length > 0) {
            whereClause += ` AND (${scopeClauses.join(' OR ')})`;
        } else if (searchTerm) {
            whereClause += ` AND 1=0`; 
        }


        if (forumIds.length > 0) {
            const placeholders = forumIds.map(() => '?').join(',');
            if (searchMode === 'all') {
                whereClause += ` AND p.id IN (
                    SELECT post_id FROM post_categories 
                    WHERE forum_id IN (${placeholders})
                    GROUP BY post_id HAVING COUNT(DISTINCT forum_id) = ${forumIds.length}
                )`;
            } else {
                whereClause += ` AND p.id IN (
                    SELECT post_id FROM post_categories WHERE forum_id IN (${placeholders})
                )`;
            }
            queryParams = [...queryParams, ...forumIds];
        }

        // 1. Get total count for pagination
        const [countResult] = await db.execute(
            `SELECT COUNT(DISTINCT p.id) as total FROM posts p WHERE ${whereClause}`,
            queryParams
        );
        const totalPosts = countResult[0].total;
        const totalPages = Math.ceil(totalPosts / limit);

        // 2. Fetch the posts
        const query = `
            SELECT 
                p.*, u.username, u.id as userId, 
                GROUP_CONCAT(DISTINCT f.title) as categories,
                GROUP_CONCAT(DISTINCT f.id) as forum_ids,

                -- Voting Subqueries
                (SELECT COUNT(*) FROM post_votes WHERE post_id = p.id AND vote_type = 1) as upvotes,
                (SELECT COUNT(*) FROM post_votes WHERE post_id = p.id AND vote_type = -1) as downvotes,
                (SELECT vote_type FROM post_votes WHERE post_id = p.id AND user_id = ? LIMIT 1) as userVote,

                (SELECT GROUP_CONCAT(id ORDER BY id ASC) FROM post_images WHERE post_id = p.id) as image_ids,
                (SELECT GROUP_CONCAT(image_url ORDER BY id ASC) FROM post_images WHERE post_id = p.id) as all_images,
                (SELECT image_url FROM post_images WHERE post_id = p.id ORDER BY id ASC LIMIT 1) as thumbnail,
                (SELECT COUNT(*) FROM post_images WHERE post_id = p.id) as image_count
            FROM posts p 
            JOIN users u ON p.user_id = u.id
            LEFT JOIN post_categories pc ON p.id = pc.post_id
            LEFT JOIN forums f ON pc.forum_id = f.id
            WHERE ${whereClause}
            GROUP BY p.id
            ORDER BY p.created_at DESC
            LIMIT ? OFFSET ?
        `;

        const [posts] = await db.execute(query, [
            currentUserId,
            ...queryParams, 
            limit.toString(), 
            offset.toString()
        ]);

        
        // 3. Fetch all forums so the user can see/change filters on the results page
        const [allForums] = await db.execute(
            'SELECT id, title, header, order_by FROM forums ORDER BY order_by ASC, title ASC'
        );

        
        res.render('pages/search', { 
            posts,
            allForums,
            scope: scope,
            searchMode: searchMode,
            selectedForums: forumIds,
            timeAgo: timeAgo,
            currentPage: page,
            totalPages: totalPages,
            searchKey: searchTerm,
            user: res.userInfo,
            siteTitle: "Search Results"
        });
    } catch (err) {
        console.error("Search Error:", err);
        res.status(500).send('Search Error');
    }
});

// Contribute Page
router.get('/contribute', async (req, res) => {
    try {
        // 1. Fetch ALL forums for the "Post" checkboxes
        // Sorted by header so they group nicely in the view
        const [allForums] = await db.execute(`
            SELECT id, title, header, order_by
            FROM forums 
            ORDER BY header ASC, order_by ASC, title ASC
        `);

        const [headers] = await db.execute(`
            SELECT DISTINCT header as name 
            FROM forums 
            WHERE header IS NOT NULL AND header != ''
            ORDER BY header DESC
        `);

        res.render('pages/contribute', { 
            allForums: allForums,
            forums: headers,
            user: res.userInfo,
        });
    } catch (err) {
        console.error('Database Error:', err);
        res.status(500).send("Internal Server Error");
    }
});

// Categories Page
router.get('/categories', async (req, res) => {
    try {
        const query = `
            SELECT 
                f.id, f.title, f.bio, f.header, 
                -- Count occurrences in the join table for this forum
                (SELECT COUNT(*) FROM post_categories pc 
                 JOIN posts p ON pc.post_id = p.id 
                 WHERE pc.forum_id = f.id AND p.deleted = 0) AS postCount,
                lp.title AS lastPostTitle,
                lp.created_at AS lastPostDate,
                u.username AS lastPostUser
            FROM forums f
            LEFT JOIN (
                -- Find the latest post ID linked to each forum
                SELECT pc.forum_id, MAX(pc.post_id) as max_id
                FROM post_categories pc
                JOIN posts p ON pc.post_id = p.id
                WHERE p.deleted = 0
                GROUP BY pc.forum_id
            ) latest_post_id ON f.id = latest_post_id.forum_id
            LEFT JOIN posts lp ON latest_post_id.max_id = lp.id
            LEFT JOIN users u ON lp.user_id = u.id
            ORDER BY f.created_at DESC`;

        // Keep your contributors query as is (user total posts)
        const contributorsQuery = `
            SELECT 
                u.username, 
                COUNT(DISTINCT p.id) AS post_count 
            FROM users u
            JOIN posts p ON u.id = p.user_id
            -- Join the bridge table first
            JOIN post_categories pc ON p.id = pc.post_id 
            -- Then join the forums table using the bridge
            JOIN forums f ON f.id = pc.forum_id 
            WHERE p.deleted = 0 
            -- AND u.id != 1 
            AND f.header != 'General'
            GROUP BY u.id, u.username
            ORDER BY post_count DESC 
            LIMIT 10;`;

        const [topContributors] = await db.execute(contributorsQuery);
        const [rawForums] = await db.execute(query);         

        const grouped = rawForums.reduce((acc, forum) => {
            const key = forum.header;
            if (!acc[key]) acc[key] = [];
            acc[key].push(forum);
            return acc;
        }, {});
        // 2. Helper function to generate a random hex color
        const getRandomColor = () => {
            const letters = '0123456789ABCDEF';
            let color = '#';
            for (let i = 0; i < 6; i++) {
                color += letters[Math.floor(Math.random() * 16)];
            }
            return color;
        };
        const finalForums = Object.keys(grouped).map(headerName => {
            return {
                name: headerName,
                icon: 'fa-folder', // Generic icon as requested
                color: getRandomColor(), // Random color for each section
                data: grouped[headerName]
            };
        });

        res.render('pages/categories', { 
            forums: finalForums,
            user: res.userInfo,
            topContributors: topContributors,
            timeAgo
        });

    } catch (err) {
        console.error('Database Error:', err);
        res.status(500).send('Internal Server Error');
    }
});

// Libaray
router.get('/my-library/:id?', async (req, res) => {
    const userId = res.userInfo?.id;
    const playlistId = req.params.id;
    
    // Pagination logic
    const limit = 12;
    const offset = parseInt(req.query.offset) || 0; // Use offset instead of page for easier JS math

    if (!userId) return res.redirect('/login');

    try {
        if (playlistId) {
            // VIEW A SINGLE PLAYLIST
            const [playlistInfo] = await db.execute(
                'SELECT * FROM playlists WHERE id = ? AND user_id = ?', 
                [playlistId, userId]
            );
            
            if (playlistInfo.length === 0) return res.status(404).send("Playlist not found");

            const [posts] = await db.execute(`
                SELECT p.*, u.username, 
                (SELECT image_url FROM post_images WHERE post_id = p.id LIMIT 1) as thumbnail
                FROM playlist_items pi
                JOIN posts p ON pi.post_id = p.id
                JOIN users u ON p.user_id = u.id
                WHERE pi.playlist_id = ?
                ORDER BY pi.id DESC
                LIMIT ${limit} OFFSET ${offset} 
            `, [playlistId]);

            // --- SMART PART START ---
            // If request wants JSON, just send the posts (for Load More / Infinite Scroll)
            if (req.xhr || req.headers.accept.indexOf('json') > -1) {
                return res.json({ posts });
            }
            // --- SMART PART END ---

            res.render('pages/library-detail', { 
                playlist: playlistInfo[0],
                playlistName: playlistInfo[0].name, 
                playlistId: playlistId,
                posts, 
                user: res.userInfo,
                timeAgo
            });
        } else {
            // VIEW ALL PLAYLISTS (Keep as is)
            const [lists] = await db.execute(`
                SELECT p.*, 
                (SELECT COUNT(*) FROM playlist_items WHERE playlist_id = p.id) as item_count,
                (
                    SELECT pimg.image_url 
                    FROM playlist_items pi 
                    JOIN post_images pimg ON pi.post_id = pimg.post_id 
                    WHERE pi.playlist_id = p.id 
                    ORDER BY pi.id DESC
                    LIMIT 1
                ) as cover_img
                FROM playlists p
                WHERE p.user_id = ?
                ORDER BY p.created_at DESC
            `, [userId]);

            res.render('pages/library-main', { lists, user: res.userInfo });
        }
    } catch (err) {
        console.log(err);
        res.status(500).send("Error loading library");
    }
});

// Share Public Playlist
router.get('/playlist/view/:id', async (req, res) => {
    const playlistId = req.params.id;
    const viewerId = res.userInfo?.id; // To check if the viewer happens to be the owner

    try {
        // 1. Get playlist info and owner details
        const [playlistInfo] = await db.execute(`
            SELECT p.*, u.username as owner_name 
            FROM playlists p 
            JOIN users u ON p.user_id = u.id 
            WHERE p.id = ?
        `, [playlistId]);

        if (playlistInfo.length === 0) return res.status(404).send("Playlist not found");
        
        const playlist = playlistInfo[0];

        // 2. Privacy Check: If private, only owner can see
        if (playlist.is_public === 0 && playlist.user_id !== viewerId) {
            return res.status(403).send("This playlist is private");
        }

        // 3. Get posts for this playlist
        const [posts] = await db.execute(`
            SELECT p.*, u.username, 
            (SELECT image_url FROM post_images WHERE post_id = p.id LIMIT 1) as thumbnail
            FROM playlist_items pi
            JOIN posts p ON pi.post_id = p.id
            JOIN users u ON p.user_id = u.id
            WHERE pi.playlist_id = ?
            ORDER BY pi.id DESC
        `, [playlistId]);

        res.render('pages/library-view-shared', { 
            playlist, 
            posts, 
            isOwner: playlist.user_id === viewerId,
            user: res.userInfo,
            timeAgo
        });
    } catch (err) {
        res.status(500).send("Error loading shared playlist");
    }
});

// Requests Page
router.get('/requests', async (req, res) => {
    try {
        const filter = req.query.filter || ''; // '', 'open', 'pending', 'finished', 'mine'
        const userId = res.userInfo.id;
        
        let query = `
            SELECT 
                r.*, 
                u.username, 
                (SELECT username FROM users WHERE id = r.fulfilled_by_id) as contributor_name,
                p.title as post_title,
                img.image_url as post_preview
            FROM content_requests r 
            JOIN users u ON r.user_id = u.id
            LEFT JOIN posts p ON r.fulfilled_post_id = p.id
            LEFT JOIN (
                /* This subquery picks only the FIRST image for each post */
                SELECT post_id, MIN(image_url) as image_url 
                FROM post_images 
                GROUP BY post_id
            ) img ON p.id = img.post_id
        `;
        
        let params = [];

        // Logic Switch
        if (filter === 'mine') {
            query += " WHERE r.user_id = ? ";
            params.push(userId);
        } else if (['open', 'pending', 'finished'].includes(filter)) {
            query += " WHERE r.status = ? ";
            params.push(filter);
        } else {
            query += " WHERE 1 = 1 ";
        }

        query += " ORDER BY r.created_at DESC";

        const [requests] = await db.execute(query, params);

        res.render('pages/requests', { 
            requests, 
            user: res.userInfo, 
            currentFilter: filter,
            timeAgo
        });
    } catch (err) {
        console.error(err);
        res.status(500).send("Error");
    }
});

// Request Create
router.post('/requests/create', async (req, res) => {
    try {
        const { message } = req.body;
        await db.execute('INSERT INTO content_requests (user_id, message) VALUES (?, ?)', 
        [res.userInfo.id, message]);
        res.redirect('/requests');
    } catch (err) {
        res.status(500).send("Error");
    }
});

// Request Contributor submits the finished post URL
router.post('/requests/fulfill/:requestId', async (req, res) => {
    let { postId } = req.body;
    const requestId = req.params.requestId;

    // Back-end Regex: If they sent a URL, extract the ID
    const match = postId.toString().match(/(\d+)$/);
    if (match) {
        postId = match[1];
    } else {
        return res.status(400).send("Invalid Post ID");
    }

    try {
        await db.execute(
            `UPDATE content_requests 
             SET fulfilled_post_id = ?, fulfilled_by_id = ?, status = 'pending' 
             WHERE id = ?`,
            [postId, res.userInfo.id, requestId]
        );

        const [post] = await db.execute(
            `SELECT user_id, fulfilled_post_id as post_id FROM content_requests WHERE id = ?`, 
            [requestId]
        );

        if (post.length > 0) {
            const recipientId = post[0].user_id;

            const msg = `${res.userInfo.username} has found content that you asked in Request Section, Please Check and Approve it!`;
            await createNotification(recipientId, res.userInfo.id, 'rq_pending', post[0].post_id, msg);
        }

        res.redirect('/requests?filter=pending');
    } catch (err) {
        console.error(err);
        res.status(500).send("Error");
    }
});

// Requester clicks "FINISH" / Close the request
router.post('/requests/finish/:requestId', async (req, res) => {
    const requestId = req.params.requestId;
    const userId = res.userInfo.id;

    try {
        // Ensure only the person who REQUESTED it can finish it
        await db.execute(
            "UPDATE content_requests SET status = 'finished' WHERE id = ? AND user_id = ?",
            [requestId, userId]
        );

        const [post] = await db.execute(
            `SELECT fulfilled_by_id as recipient FROM content_requests WHERE id = ?`, 
            [requestId]
        );

        if (post.length > 0) {
            const recipientId = post[0].recipient;

            const msg = `Congratulations, ${res.userInfo.username} Approved the answer you given in his Content Request!`;
            await createNotification(recipientId, userId, 'rq_finish', null, msg);
        }

        res.redirect('/requests');
    } catch (err) {
        res.status(500).send("Error finishing request");
    }
});



module.exports = router;



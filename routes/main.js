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

// Main Page Route
router.get('/', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 15;
        const offset = (page - 1) * limit;

        const [countResult] = await db.execute('SELECT COUNT(*) as total FROM posts WHERE deleted = 0');
        const totalPosts = countResult[0].total;
        const totalPages = Math.ceil(totalPosts / limit);

        const [posts] = await db.execute(`
                SELECT p.*, u.username, u.id as userId, 
                GROUP_CONCAT(DISTINCT f.title) as categories,
                GROUP_CONCAT(DISTINCT f.id) as forum_ids,
                -- This gets all URLs for display
                (SELECT GROUP_CONCAT(image_url ORDER BY id ASC) FROM post_images WHERE post_id = p.id) as all_images,
                -- This gets all IDs for the 'Replace' route
                (SELECT GROUP_CONCAT(id ORDER BY id ASC) FROM post_images WHERE post_id = p.id) as image_ids,
                -- The first image for the feed thumbnail
                (SELECT image_url FROM post_images WHERE post_id = p.id ORDER BY id ASC LIMIT 1) as thumbnail,
                (SELECT COUNT(*) FROM post_images WHERE post_id = p.id) as image_count
            FROM posts p 
            JOIN users u ON p.user_id = u.id 
            LEFT JOIN post_categories pc ON p.id = pc.post_id
            LEFT JOIN forums f ON pc.forum_id = f.id
            WHERE p.deleted = 0
            GROUP BY p.id
            ORDER BY p.created_at DESC
            LIMIT ? OFFSET ?`, [limit.toString(), offset.toString()]);
            
        const [allForums] = await db.execute(`SELECT id, title, header FROM forums ORDER BY header DESC, title ASC`);

        res.render('index', { 
            posts,
            allForums,
            user: res.userInfo,
            timeAgo,
            currentPage: page,
            totalPages,
            forumTitle: "Home",
            siteTitle: "ForumX"
        });
    } catch (err) {
        console.error('Database Error:', err);
        res.redirect("/");
    }
});

router.get('/user/:id', async (req, res) => {
    try {
        const userId = req.params.id;
        const page = parseInt(req.query.page) || 1;
        const limit = 15;
        const offset = (page - 1) * limit;

        const [countResult] = await db.execute(
            'SELECT COUNT(*) as total FROM posts WHERE user_id = ? AND deleted = 0', 
            [userId]
        );
        const totalPosts = countResult[0].total;
        const totalPages = Math.ceil(totalPosts / limit);

        const [posts] = await db.execute(`
            SELECT p.*, u.username, 
            GROUP_CONCAT(DISTINCT f.title) as categories,
            GROUP_CONCAT(DISTINCT f.id) as forum_ids,
            (SELECT GROUP_CONCAT(image_url ORDER BY id ASC) FROM post_images WHERE post_id = p.id) as all_images,
            (SELECT GROUP_CONCAT(id ORDER BY id ASC) FROM post_images WHERE post_id = p.id) as image_ids,
            (SELECT image_url FROM post_images WHERE post_id = p.id ORDER BY id ASC LIMIT 1) as thumbnail,
            (SELECT COUNT(*) FROM post_images WHERE post_id = p.id) as image_count
        FROM posts p 
        JOIN users u ON p.user_id = u.id 
        LEFT JOIN post_categories pc ON p.id = pc.post_id
        LEFT JOIN forums f ON pc.forum_id = f.id
        WHERE p.user_id = ? AND p.deleted = 0  -- Added user_id filter here
        GROUP BY p.id
        ORDER BY p.created_at DESC
        LIMIT ? OFFSET ?`, [userId, limit.toString(), offset.toString()]);
            
        const [allForums] = await db.execute(`SELECT id, title, header FROM forums ORDER BY header DESC, title ASC`);

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

// Search
router.get('/search', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 15;
        const offset = (page - 1) * limit;

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
                -- 1. Added this line to fetch the IDs for the "Replace" functionality
                (SELECT GROUP_CONCAT(id ORDER BY id ASC) FROM post_images WHERE post_id = p.id) as image_ids,
                -- 2. Added ORDER BY here to ensure URLs match the IDs above
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
            ...queryParams, 
            limit.toString(), 
            offset.toString()
        ]);

        
        // 3. Fetch all forums so the user can see/change filters on the results page
        const [allForums] = await db.execute(
            'SELECT id, title, header FROM forums ORDER BY header ASC, title ASC'
        );

        // Group forums by header
        const groupedForums = allForums.reduce((groups, forum) => {
            const header = forum.header || 'Other'; // Fallback for forums without a header
            if (!groups[header]) {
                groups[header] = [];
            }
            groups[header].push(forum);
            return groups;
        }, {});
        
        res.render('pages/search', { 
            posts,
            groupedForums: groupedForums,
            allForums,
            scope: scope,
            searchMode: searchMode,
            selectedForums: forumIds,
            user: res.userInfo,
            timeAgo: timeAgo,
            currentPage: page,
            totalPages: totalPages,
            searchKey: searchTerm,
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
            SELECT id, title, header 
            FROM forums 
            ORDER BY header ASC, title ASC
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

// Categorues 
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
            AND u.id != 1 
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

// Add this to your router
router.post('/forum/create-api-tag', async (req, res) => {
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

// Create New Tag
router.post('/forum/create', async (req, res) => {
  const userId = req.user.userId;
  const { title, header, bio } = req.body;

  if (!title || !header) {
    return res.status(400).json({ message: 'All fields are required' });
  }

  const query = `
    INSERT INTO forums (user_id,title,header,bio) VALUES (?, ?, ?, ?)
  `;

  try {
    const [result] = await db.execute(query, [userId,title,header,bio]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Error at creating forum' });
    }

    res.redirect('/contribute');
  } catch (err) {
    console.error('Error at creating forum:', err);
    res.status(500).json({ message: 'Error creating forum' });
  }

});


module.exports = router;



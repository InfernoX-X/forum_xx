const db = require('../db');

const getUserInfo = async (req, res, next) => {
  const userId = req.user.userId;
  
  try {
    const [users] = await db.execute('SELECT id, username, email, isAdmin, isBan FROM users WHERE id = ?', [userId]);
    
    const [rows] = await db.execute('SELECT COUNT(*) as total FROM posts WHERE deleted = 0 AND user_id = ?', [userId]);

    if (users.length === 0) {
      return next(new Error('User not found'));
    }
    
    const user = users[0];
    
    if(user.isBan == 1) {
      res.clearCookie('token'); 
      
      return res.redirect('/login?error=banned');
    }
    
    user.postCount = rows[0].total || 0;
    res.userInfo = user;

    next();
    
  } catch (err) {
    next(err);
  }
};


module.exports = getUserInfo;
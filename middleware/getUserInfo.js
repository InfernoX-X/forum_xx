const db = require('../db');

const getUserInfo = async (req, res, next) => {
  const userId = req.user.userId;
  
  try {
    const [users] = await db.execute('SELECT id, username, email FROM users WHERE id = ?', [userId]);
    
    if (users.length === 0) {
      return next(new Error('User not found'));
    }
    
    const user = users[0];
    
    res.userInfo = user;
    
    next();
    
  } catch (err) {
    next(err);
  }
};


module.exports = getUserInfo;
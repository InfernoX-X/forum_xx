const jwt = require('jsonwebtoken');


// Function to generate a JWT token
function generateJwtToken(user) {
    const payload = {
      userId: user.id,
      username: user.username,
      // Add any other user data you want to include in the token
    };
  
    const secret = process.env.JWT_SECRET;
    const options = { expiresIn: '30d' };
    
    return jwt.sign(payload, secret, options);
}

function verifyToken(req, res, next) {
  const token = req.cookies?.token;
  if (!token) {
    return res.redirect('/login');
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.redirect('/login');
  }
}

function isAdmin(req, res, next) {
  const token = req.cookies?.token;
  if (!token) {
    return res.redirect('/login');
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    if(decoded.userId === 1){
      req.user = decoded;
      next();
    }
    else{
      return res.redirect("/")
    }

  } catch (err) {
    return res.redirect('/');
  }
}

// Middleware to check if the user is already logged in and redirect to home
function redirectIfAuthenticated(req, res, next) {
  const token = req.cookies?.token;
  if (token) {
    try {
      jwt.verify(token, process.env.JWT_SECRET);
      return res.redirect('/');
    } catch (err) {
      // Token is invalid, proceed to the next middleware or route handler
      next();
    }
  } else {
    next();
  }
}

module.exports = {generateJwtToken,verifyToken,isAdmin,redirectIfAuthenticated}

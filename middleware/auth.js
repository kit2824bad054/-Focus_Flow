const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'focusflow_jwt_secret_key_2026';

/**
 * JWT Authentication Middleware
 * Validates 'Authorization: Bearer <token>' header
 * Attaches decoded user { _id, email, name } to req.user
 */
const authMiddleware = (req, res, next) => {
  try {
    const authHeader = req.header('Authorization') || req.header('x-auth-token');
    if (!authHeader) {
      return res.status(401).json({
        success: false,
        error: 'Authorization denied. No token provided.',
      });
    }

    const token = authHeader.startsWith('Bearer ')
      ? authHeader.slice(7).trim()
      : authHeader.trim();

    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Authorization denied. Token is empty.',
      });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    const userId = decoded.id || decoded.userId || decoded._id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Token is invalid (missing user identifier).',
      });
    }

    req.user = {
      _id: userId,
      id: userId,
      email: decoded.email,
      name: decoded.name,
    };

    next();
  } catch (err) {
    return res.status(401).json({
      success: false,
      error: 'Token is invalid or expired.',
      details: err.message,
    });
  }
};

/**
 * Helper to generate signed JWT for a user
 */
const generateToken = (user) => {
  const payload = {
    id: user._id ? user._id.toString() : user.id,
    email: user.email,
    name: user.name,
  };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
};

module.exports = {
  authMiddleware,
  generateToken,
};


const jwt = require('jsonwebtoken');
const prisma = require('../utils/prisma');

const protect = async (req, res, next) => {
    try {
        let token;
        if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
            token = req.headers.authorization.split(' ')[1];
        }
        if (!token && req.query && typeof req.query.token === 'string') {
            token = req.query.token;
        }
        if (!token) {
            return res.status(401).json({ success: false, message: 'Not authorized, no token' });
        }
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        const user = await prisma.user.findUnique({ 
            where: { id: decoded.id } 
        });
        
        if (!user) {
            return res.status(401).json({ success: false, message: 'User not found' });
        }
        
        const { password, ...userWithoutPassword } = user;
        req.user = userWithoutPassword;
        next();
    } catch (err) {
        return res.status(401).json({ success: false, message: 'Token invalid or expired' });
    }
};

const authorize = (...roles) => (req, res, next) => {
    if (!roles.includes(req.user.role)) {
        return res.status(403).json({
            success: false,
            message: `Role '${req.user.role}' is not authorized for this action`
        });
    }
    next();
};

module.exports = { protect, authorize };

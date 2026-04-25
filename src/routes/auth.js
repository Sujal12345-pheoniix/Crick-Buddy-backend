const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const prisma = require('../utils/prisma');
const { generateToken, generateRefreshToken } = require('../utils/jwt');

// Helper to remove password from user object
const toPublicJSON = (user) => {
    const { password, ...publicUser } = user;
    return publicUser;
};

// POST /api/auth/register
router.post('/register', async (req, res) => {
    try {
        const { name, email, password, role, playerType, experienceLevel, battingStyle, bowlingStyle } = req.body;
        const normalizedName = String(name || '').trim();
        const normalizedEmail = String(email || '').trim().toLowerCase();

        if (!normalizedName || !normalizedEmail || !password) {
            return res.status(400).json({ success: false, message: 'Name, email and password are required' });
        }
        if (password.length < 6) {
            return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
        }

        const exists = await prisma.user.findUnique({ where: { email: normalizedEmail } });
        if (exists) {
            return res.status(409).json({ success: false, message: 'Email already registered' });
        }

        const hashedPassword = await bcrypt.hash(password, 12);
        
        const user = await prisma.user.create({
            data: {
                name: normalizedName,
                email: normalizedEmail,
                password: hashedPassword,
                role: role || 'player',
                playerType: playerType || 'batsman',
                experienceLevel: experienceLevel || 'beginner',
                battingStyle: battingStyle || 'right-handed',
                bowlingStyle: bowlingStyle || 'none'
            }
        });

        const token = generateToken(user.id);
        const refreshToken = generateRefreshToken(user.id);

        res.status(201).json({
            success: true,
            message: 'Account created successfully',
            token,
            refreshToken,
            user: toPublicJSON(user)
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const normalizedEmail = String(email || '').trim().toLowerCase();
        if (!normalizedEmail || !password) {
            return res.status(400).json({ success: false, message: 'Email and password required' });
        }

        const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
        if (!user) {
            return res.status(401).json({ success: false, message: 'Invalid credentials' });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ success: false, message: 'Invalid credentials' });
        }

        const updatedUser = await prisma.user.update({
            where: { id: user.id },
            data: { lastLogin: new Date() }
        });

        const token = generateToken(user.id);
        const refreshToken = generateRefreshToken(user.id);

        res.json({
            success: true,
            message: 'Login successful',
            token,
            refreshToken,
            user: toPublicJSON(updatedUser)
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// GET /api/auth/me
const { protect } = require('../middleware/auth');
router.get('/me', protect, (req, res) => {
    res.json({ success: true, user: req.user });
});

module.exports = router;

const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { protect } = require('../middleware/auth');
const prisma = require('../utils/prisma');

// Helper to remove password from user object
const toPublicJSON = (user) => {
    const { password, ...publicUser } = user;
    return publicUser;
};

// GET /api/users/profile
router.get('/profile', protect, async (req, res) => {
    res.json({ success: true, user: toPublicJSON(req.user) });
});

// PUT /api/users/profile
router.put('/profile', protect, async (req, res) => {
    try {
        const allowed = ['name', 'phone', 'dateOfBirth', 'battingStyle', 'bowlingStyle', 'playerType', 'experienceLevel'];
        const updates = {};
        allowed.forEach(field => {
            if (req.body[field] !== undefined) updates[field] = req.body[field];
        });

        // Prisma date format
        if (updates.dateOfBirth) updates.dateOfBirth = new Date(updates.dateOfBirth);

        const user = await prisma.user.update({
            where: { id: req.user.id },
            data: updates
        });
        
        res.json({ success: true, user: toPublicJSON(user) });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// PUT /api/users/change-password
router.put('/change-password', protect, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        if (!currentPassword || !newPassword) {
            return res.status(400).json({ success: false, message: 'Both passwords required' });
        }
        if (newPassword.length < 6) {
            return res.status(400).json({ success: false, message: 'New password must be at least 6 chars' });
        }

        const user = await prisma.user.findUnique({ where: { id: req.user.id } });
        const isMatch = await bcrypt.compare(currentPassword, user.password);
        if (!isMatch) return res.status(400).json({ success: false, message: 'Current password incorrect' });

        const hashedPassword = await bcrypt.hash(newPassword, 12);
        
        await prisma.user.update({
            where: { id: user.id },
            data: { password: hashedPassword }
        });
        
        res.json({ success: true, message: 'Password changed successfully' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;

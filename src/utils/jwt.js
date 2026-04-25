const jwt = require('jsonwebtoken');

const isProduction = process.env.NODE_ENV === 'production';

const resolveSecret = (name, devFallback) => {
    const value = process.env[name];
    if (value && value.trim()) return value;

    if (isProduction) {
        throw new Error(`${name} environment variable is required in production`);
    }

    console.warn(`[auth] ${name} is not set, using a local development fallback secret.`);
    return devFallback;
};

const accessSecret = resolveSecret('JWT_SECRET', 'local-dev-jwt-secret-change-me');
const refreshSecret = resolveSecret('JWT_REFRESH_SECRET', 'local-dev-refresh-secret-change-me');

const generateToken = (id) => {
    return jwt.sign({ id }, accessSecret, {
        expiresIn: process.env.JWT_EXPIRES_IN || '7d'
    });
};

const generateRefreshToken = (id) => {
    return jwt.sign({ id }, refreshSecret, { expiresIn: '30d' });
};

module.exports = { generateToken, generateRefreshToken };

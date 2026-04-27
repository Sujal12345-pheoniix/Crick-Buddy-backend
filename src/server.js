require('dotenv').config();

const express = require('express');
const cors = require('cors');   // ✅ ADD THIS
const app = require('./app');

const PORT = process.env.PORT || 5000;

// ✅ CORS MUST COME BEFORE ROUTES
app.use(cors({
  origin: "https://crick-buddy-frontend.vercel.app",
  credentials: true
}));

// ✅ HEALTH CHECK ROUTE
app.get("/", (req, res) => {
  res.send("CrickBuddy Backend Running 🚀");
});

// ✅ START SERVER
app.listen(PORT, () => {
  console.log(`✅ Crick-Buddy Backend running on PORT ${PORT}`);
});
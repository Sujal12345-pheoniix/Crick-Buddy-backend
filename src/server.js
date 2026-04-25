require('dotenv').config();
const app = require('./app');

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`✅ Crick-Buddy Backend running on http://localhost:${PORT}`);
});

app.get("/", (req, res) => {
  res.send("CrickBuddy Backend Running 🚀");
});


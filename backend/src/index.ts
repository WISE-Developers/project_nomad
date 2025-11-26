import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Health check endpoint
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'nomad-backend',
    timestamp: new Date().toISOString(),
  });
});

// API info endpoint
app.get('/api', (_req, res) => {
  res.json({
    name: 'Project Nomad API',
    version: '0.1.0',
    description: 'Fire Modeling Backend API',
  });
});

app.listen(PORT, () => {
  console.log(`Nomad backend running on http://localhost:${PORT}`);
});

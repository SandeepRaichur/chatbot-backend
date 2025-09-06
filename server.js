import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import { CohereClientV2 } from "cohere-ai";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import mongoose from 'mongoose';

// Load environment variables
dotenv.config();
//Database Connection code
mongoose.connect(process.env.MONGO_URI)
.then(()=>{
    console.log("Connected to MongoDB")
}).catch((error)=>{
    console.log("Error connecting to MongoDB:", error)
})

// Validate required environment variables
if (!process.env.COHERE_API_KEY) {
  console.error("❌ COHERE_API_KEY is missing from environment variables");
  process.exit(1);
}

console.log("✅ API Key loaded successfully");

const app = express();
const PORT = process.env.PORT || 3001;

// CORS configuration
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000']
    : true,
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Body parser with size limits
app.use(bodyParser.json({ 
  limit: '10mb',
  verify: (req, res, buf) => {
    try {
      JSON.parse(buf);
    } catch (e) {
      res.status(400).json({ error: 'Invalid JSON format' });
      throw new Error('Invalid JSON');
    }
  }
}));

app.use(bodyParser.urlencoded({ 
  extended: true, 
  limit: '10mb' 
}));

// Initialize Cohere AI
const cohere = new CohereClientV2({
  token: process.env.COHERE_API_KEY,
});

// Input validation middleware
const validateChatInput = (req, res, next) => {
  const { prompt } = req.body;
  
  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({
      error: "Invalid input",
      message: "Prompt is required and must be a string"
    });
  }
  
  if (prompt.trim().length === 0) {
    return res.status(400).json({
      error: "Invalid input",
      message: "Prompt cannot be empty"
    });
  }
  
  if (prompt.length > 5000) {
    return res.status(400).json({
      error: "Invalid input",
      message: "Prompt is too long (maximum 5000 characters)"
    });
  }
  
  // Sanitize prompt
  req.body.prompt = prompt.trim();
  next();
};

// Enhanced system prompt for better financial assistance
const SYSTEM_PROMPT = `You are a professional financial assistant with expertise in:
- Investment strategies and portfolio management
- Stock market analysis and trends
- Banking products and services
- Personal finance and budgeting
- Economic indicators and market conditions
- Cryptocurrency and digital assets
- Retirement planning and insurance
- Tax planning and financial regulations

Guidelines:
- Provide accurate, well-researched financial information
- Always include appropriate disclaimers about investment risks
- Suggest consulting with qualified financial advisors for personalized advice
- Use clear, accessible language while maintaining professional accuracy
- Cite relevant financial concepts and principles
- Stay current with market trends and economic developments

Remember: This is educational information only and not personalized financial advice.`;

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage()
  });
});

// Main chat endpoint
app.post("/api/chat", validateChatInput, async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { prompt } = req.body;
    
    console.log(`📝 Processing request: ${prompt.substring(0, 100)}...`);
    
    // Generate response with timeout
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Request timeout')), 30000)
    );
    
    // Correct Cohere V2 API implementation
    const generatePromise = cohere.chat({
      model: "command-r-plus-08-2024",
      messages: [
        {
          role: "system",
          content: SYSTEM_PROMPT
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.7,
      maxTokens: 2048
    });
    
    const result = await Promise.race([generatePromise, timeoutPromise]);
    
    // Extract the response text correctly
    let reply = '';
    if (result.message && result.message.content && result.message.content.length > 0) {
      reply = result.message.content[0].text;
    } else {
      throw new Error('Invalid response format from Cohere API');
    }
    
    const responseTime = Date.now() - startTime;
    
    console.log(`✅ Response generated in ${responseTime}ms`);
    
    res.json({ 
      content: reply,
      metadata: {
        responseTime,
        timestamp: new Date().toISOString(),
        model: "command-r-plus-08-2024",
        usage: result.usage || {}
      }
    });
    
  } catch (error) {
    const responseTime = Date.now() - startTime;
    
    console.error("❌ Cohere API Error:", {
      message: error.message,
      stack: error.stack,
      responseTime,
      statusCode: error.statusCode,
      body: error.body
    });
    
    // Handle different types of errors
    if (error.message === 'Request timeout') {
      return res.status(408).json({
        error: "Request timeout",
        message: "The request took too long to process. Please try again.",
        code: "TIMEOUT"
      });
    }
    
    if (error.statusCode === 401 || error.message?.includes('authentication') || error.message?.includes('API key') || error.message?.includes('Unauthorized')) {
      return res.status(401).json({
        error: "Authentication failed",
        message: "Invalid or missing API key. Please check your COHERE_API_KEY.",
        code: "AUTH_ERROR"
      });
    }
    
    if (error.statusCode === 429 || error.message?.includes('quota') || error.message?.includes('limit') || error.message?.includes('rate')) {
      return res.status(429).json({
        error: "Rate limit exceeded",
        message: "API quota exceeded. Please try again later.",
        code: "QUOTA_EXCEEDED"
      });
    }
    
    if (error.statusCode === 400) {
      return res.status(400).json({
        error: "Bad request",
        message: "Invalid request parameters: " + (error.message || 'Unknown error'),
        code: "BAD_REQUEST"
      });
    }
    
    // Generic error response
    res.status(500).json({
      error: "Internal server error",
      message: process.env.NODE_ENV === 'development' 
        ? `${error.message} | StatusCode: ${error.statusCode || 'N/A'}` 
        : "An unexpected error occurred. Please try again.",
      code: "INTERNAL_ERROR",
      timestamp: new Date().toISOString()
    });
  }
});

// Get conversation history endpoint (if you want to add this feature later)
app.get("/api/conversations", (req, res) => {
  res.json({
    message: "Conversation history feature coming soon",
    status: "not_implemented"
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    error: "Endpoint not found",
    message: `The requested endpoint ${req.method} ${req.originalUrl} was not found`,
    availableEndpoints: [
      'GET /health',
      'POST /api/chat',
      'GET /api/conversations'
    ]
  });
});

// Global error handler
app.use((error, req, res, next) => {
  console.error('❌ Unhandled error:', error);
  
  res.status(500).json({
    error: "Internal server error",
    message: process.env.NODE_ENV === 'development' 
      ? error.message 
      : "An unexpected error occurred",
    timestamp: new Date().toISOString()
  });
});

// Graceful shutdown handling
process.on('SIGTERM', () => {
  console.log('📴 SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('📴 SIGINT received, shutting down gracefully');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});

// Start server
const server = app.listen(PORT, () => {
  console.log(`🚀 Financial Assistant Server running on port ${PORT}`);
  console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔗 Health check: http://localhost:${PORT}/health`);
  console.log(`💬 Chat endpoint: http://localhost:${PORT}/api/chat`);
});

export default app;
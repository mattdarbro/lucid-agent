import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { config, validateConfig } from './config';
import { testConnection, closeConnections, pool, supabase } from './db';
import { logger } from './logger';
import usersRouter from './routes/users';
import conversationsRouter from './routes/conversations';
import messagesRouter from './routes/messages';
import factsRouter from './routes/facts';
import evidenceRouter from './routes/evidence';
import chatRouter from './routes/chat';
import summaryRouter from './routes/summary';
import personalityRouter from './routes/personality';
import { createAgentJobRouter } from './routes/agent-jobs';
import { createAutonomousThoughtRouter } from './routes/autonomous-thoughts';
import { createResearchTaskRouter } from './routes/research-tasks';
import profilesRouter from './routes/profiles';
import thoughtNotificationsRouter from './routes/thought-notifications';
import multiDayTasksRouter from './routes/multi-day-tasks';
import taskInsightsRouter from './routes/task-insights';
import { SchedulerService } from './services/scheduler.service';
import { BackgroundJobsService } from './services/background-jobs.service';
import libraryRouter from './routes/library';
import versusRouter from './routes/versus';

// Validate configuration on startup
try {
  validateConfig();
  logger.info('Configuration validated successfully');
} catch (error: any) {
  logger.error('Configuration validation failed:', error.message);
  process.exit(1);
}

const app = express();
const PORT = config.port;
const HOST = '0.0.0.0';

// Middleware
app.use(
  cors({
    origin: true, // Allow all origins (Railway URLs, localhost, iOS, etc.)
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    exposedHeaders: ['Content-Type'],
    maxAge: 86400, // 24 hours preflight cache
  })
);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging with error tracking
app.use((req, res, next) => {
  const start = Date.now();
  logger.debug(`${req.method} ${req.path}`);

  // Log response status
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.debug(`${req.method} ${req.path} - ${res.statusCode} (${duration}ms)`);
  });

  next();
});

// ============================================================================
// HEALTH & INFO ENDPOINTS
// ============================================================================

app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'lucid-agent',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
});

app.get('/info', (req, res) => {
  res.json({
    agent: config.agent.name,
    features: config.features,
    studioApi: config.studioApi.url,
    version: '1.0.0',
  });
});

// ============================================================================
// ROUTES
// ============================================================================

app.use('/v1/users', usersRouter);
app.use('/v1/conversations', conversationsRouter);
app.use('/v1/messages', messagesRouter);
app.use('/v1/facts', factsRouter);
app.use('/v1/users/:user_id/facts', factsRouter);
app.use('/v1/evidence', evidenceRouter);
app.use('/v1/facts/:fact_id/evidence', evidenceRouter);
app.use('/v1/chat', chatRouter);
app.use('/v1/summaries', summaryRouter);
app.use('/v1/conversations/:conversation_id/summaries', summaryRouter);
app.use('/v1/users/:user_id/summaries', summaryRouter);

// Phase 3: Emotional Intelligence routes
app.use('/v1/personality', personalityRouter);

// Phase 4: Autonomous Agents routes
app.use('/v1/agent-jobs', createAgentJobRouter(pool, supabase));
app.use('/v1/autonomous-thoughts', createAutonomousThoughtRouter(pool, supabase));
app.use('/v1/research-tasks', createResearchTaskRouter(pool, supabase));

// Phase 5: Temporal Check-In System
app.use('/v1/thought-notifications', thoughtNotificationsRouter);
app.use('/v1/multi-day-tasks', multiDayTasksRouter);
app.use('/v1/users/:user_id/multi-day-tasks', multiDayTasksRouter);
app.use('/v1/tasks', taskInsightsRouter); // Task insights and conversations
app.use('/v1/insights', taskInsightsRouter); // Direct insight access

// Profile Management (Modular Configuration)
app.use('/v1/profiles', profilesRouter);

// Library (Phase 2 - autonomous thoughts and user reflections)
app.use('/v1/library', libraryRouter);

// Versus Mode (Phase F - Lu & Cid debates)
app.use('/v1/versus', versusRouter);

// TODO: Memory endpoints (unified memory interface)
// app.use('/v1/memory', memoryRouter);

// ============================================================================
// ERROR HANDLERS
// ============================================================================

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ============================================================================
// SERVER STARTUP
// ============================================================================

// Initialize scheduler (will be started if autonomous agents are enabled)
let scheduler: SchedulerService | null = null;
let backgroundJobs: BackgroundJobsService | null = null;

async function startServer() {
  try {
    // Test database connection
    logger.info('Testing database connection...');
    const dbConnected = await testConnection();

    if (!dbConnected) {
      logger.error('Failed to connect to database. Exiting...');
      process.exit(1);
    }

    // Start Express server
    const server = app.listen(PORT, HOST, async () => {
      logger.info(`🧠 ${config.agent.name} agent running on ${HOST}:${PORT}`);
      logger.info(`📊 Health: http://localhost:${PORT}/health`);
      logger.info(`ℹ️  Info: http://localhost:${PORT}/info`);
      logger.info(`🔗 Studio API: ${config.studioApi.url}`);

      if (config.features.autonomousAgents) {
        logger.info('🤖 Autonomous agents: ENABLED');

        // Start the scheduler for autonomous agents
        try {
          scheduler = new SchedulerService(pool, supabase);
          await scheduler.start();
          logger.info('✅ Scheduler started successfully');
        } catch (error) {
          logger.error('Failed to start scheduler:', error);
          logger.warn('⚠️  Continuing without autonomous agents');
        }
      }
      if (config.features.dreams) {
        logger.info('💭 Dreams: ENABLED');
      }
      if (config.features.webResearch) {
        logger.info('🔍 Web research: ENABLED');
      }

      // Start background jobs for automatic fact extraction
      try {
        backgroundJobs = new BackgroundJobsService(pool);
        backgroundJobs.start();
        logger.info('📚 Background jobs: STARTED (fact extraction every 5 minutes)');
      } catch (error) {
        logger.error('Failed to start background jobs:', error);
        logger.warn('⚠️  Continuing without background fact extraction');
      }
    });

    // Graceful shutdown handlers
    const shutdown = async () => {
      logger.info('Shutting down gracefully...');

      // Stop scheduler if running
      if (scheduler) {
        logger.info('Stopping scheduler...');
        scheduler.stop();
      }

      // Stop background jobs if running
      if (backgroundJobs) {
        logger.info('Stopping background jobs...');
        backgroundJobs.stop();
      }

      server.close(async () => {
        await closeConnections();
        logger.info('Server shut down complete');
        process.exit(0);
      });

      // Force shutdown after 10 seconds
      setTimeout(() => {
        logger.error('Forced shutdown after timeout');
        process.exit(1);
      }, 10000);
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);

    // Error handlers
    server.on('error', (error: any) => {
      logger.error('Server error:', error);
      if (error.code === 'EADDRINUSE') {
        logger.error(`Port ${PORT} is already in use`);
        process.exit(1);
      }
    });

    process.on('uncaughtException', (error) => {
      logger.error('Uncaught exception:', error);
      process.exit(1);
    });

    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled rejection:', { promise, reason });
      process.exit(1);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Start the server
startServer();

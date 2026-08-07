import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { config, validateConfig } from './config';
import { requireApiToken } from './middleware/auth';
import ttsRouter from './routes/tts';
import { testConnection, closeConnections, pool, supabase } from './db';
import { logger } from './logger';
import usersRouter from './routes/users';
import conversationsRouter from './routes/conversations';
import messagesRouter from './routes/messages';
import factsRouter from './routes/facts';
import evidenceRouter from './routes/evidence';
import chatRouter from './routes/chat';
import summaryRouter from './routes/summary';
import { createAgentJobRouter } from './routes/agent-jobs';
import { createResearchTaskRouter } from './routes/research-tasks';
import profilesRouter from './routes/profiles';
import thoughtNotificationsRouter from './routes/thought-notifications';
import multiDayTasksRouter from './routes/multi-day-tasks';
import taskInsightsRouter from './routes/task-insights';
import { BackgroundJobsService } from './services/background-jobs.service';
import { LibraryAudioService, getLibraryAudio } from './services/library-audio.service';
import libraryRouter from './routes/library';
import versusRouter from './routes/versus';
import syncRouter from './routes/sync';
import devicesRouter from './routes/devices';
import mergeRouter from './routes/merge';
import costsRouter from './routes/costs';
import { createMattStateRouter } from './routes/matt-state';
import { createOrbitsRouter } from './routes/orbits';
import { createLivingDocumentRouter } from './routes/living-document';
import { createStateCheckRouter } from './routes/state-check';
import researchQueueRouter from './routes/research-queue';
import winsRouter from './routes/wins';
import possibilitiesRouter from './routes/possibilities';
import { createSeedsRouter } from './routes/seeds';
// Calendar integration routes
import calendarRouter from './routes/calendar';
import peopleRouter from './routes/people';

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

// Railway terminates TLS at a proxy; trust it so req.ip (used by the rate
// limiter) reflects the real client, not the proxy.
app.set('trust proxy', 1);

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
app.use((req: Request, res: Response, next: NextFunction) => {
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

app.get('/', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'lucid-agent',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

app.get('/health', async (req: Request, res: Response) => {
  try {
    // Actually verify database connectivity for Railway health checks
    const client = await pool.connect();
    await client.query('SELECT 1');
    client.release();

    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    logger.error('Health check failed - database unreachable:', error.message);
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: 'Database connection failed',
    });
  }
});

// ============================================================================
// AUTH & RATE LIMITING
// ============================================================================
// Everything below this point (including /info and all /v1 routes) requires
// the Bearer token. `/` and `/health` above stay open for Railway checks.

app.use(requireApiToken);

// General API limiter — generous for a single-user app, exists to stop abuse
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 600,
  standardHeaders: true,
  legacyHeaders: false,
});

// Stricter limiter for endpoints that trigger LLM calls on someone's bill
const llmLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/v1', apiLimiter);
app.use('/v1/chat', llmLimiter);
app.use('/v1/versus', llmLimiter);

app.get('/info', (req: Request, res: Response) => {
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

// Seeds (simplified capture system)
app.use('/v1/tts', ttsRouter);
app.use('/v1/seeds', createSeedsRouter(pool));

// Calendar integration
app.use('/v1/calendar', calendarRouter);
app.use('/v1/people', peopleRouter);

// Agent jobs and research tasks
app.use('/v1/agent-jobs', createAgentJobRouter(pool, supabase));
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

// Manual Sync endpoints (trigger fact extraction and reflections on-demand)
app.use('/v1/sync', syncRouter);

// Device linking (multi-device support)
app.use('/v1/devices', devicesRouter);

// User data export and merge (consolidate multiple Lucid instances)
app.use('/v1/merge', mergeRouter);

// Cost tracking (API usage monitoring)
app.use('/v1/costs', costsRouter);

// Layered Memory System (Phase 6 - Matt State and Orbits)
app.use('/v1/matt-state', createMattStateRouter(pool));
app.use('/v1/orbits', createOrbitsRouter(pool));

// Living Document (Lucid's working memory - unified notes)
app.use('/v1/living-document', createLivingDocumentRouter(pool));

// State Check Tool (guided dream/goal discovery conversations)
app.use('/v1/state-check', createStateCheckRouter(pool));

// Modular Intelligence System (Research Queue)
app.use('/v1/research-queue', researchQueueRouter);

// Wins tracking (user accomplishments)
app.use('/v1/wins', winsRouter);

// Possibilities (sigma-based alternative exploration)
app.use('/v1/possibilities', possibilitiesRouter);


// TODO: Memory endpoints (unified memory interface)
// app.use('/v1/memory', memoryRouter);

// ============================================================================
// ERROR HANDLERS
// ============================================================================

// 404 handler
app.use((req: Request, res: Response) => {
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

// Initialize background jobs service
let backgroundJobs: BackgroundJobsService | null = null;
let libraryAudio: LibraryAudioService | null = null;

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

      if (config.features.webResearch) {
        logger.info('🔍 Web research: ENABLED');
      }

      // Start background jobs for automatic fact extraction and autonomous loops
      try {
        backgroundJobs = new BackgroundJobsService(pool, supabase);
        backgroundJobs.start();
        logger.info('📚 Background jobs: STARTED (fact extraction + autonomous loops)');
      } catch (error: any) {
        logger.error('Failed to start background jobs:', error);
        logger.warn('⚠️  Continuing without background fact extraction');
      }

      // Pre-generate library entry narration audio
      try {
        libraryAudio = getLibraryAudio();
        libraryAudio.start();
        logger.info('🔊 Library narration: ON-DEMAND (ElevenLabs)');
      } catch (error: any) {
        logger.error('Failed to start library audio service:', error);
        logger.warn('⚠️  Continuing without library audio pre-generation');
      }
    });

    // Graceful shutdown handlers
    const shutdown = async () => {
      logger.info('Shutting down gracefully...');

      // Stop background jobs if running
      if (backgroundJobs) {
        logger.info('Stopping background jobs...');
        backgroundJobs.stop();
      }

      if (libraryAudio) {
        libraryAudio.stop();
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

    process.on('uncaughtException', (error: Error) => {
      logger.error('Uncaught exception:', error);
      shutdown();
    });

    process.on('unhandledRejection', (reason: any, promise: any) => {
      logger.error('Unhandled rejection:', { reason });
      // Don't crash on unhandled rejections - log and continue.
      // The specific operation that failed will have its own error handling.
      // Only truly fatal issues (uncaughtException) should trigger shutdown.
    });
  } catch (error: any) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Start the server
startServer();

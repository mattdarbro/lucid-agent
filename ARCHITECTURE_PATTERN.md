# Architecture Pattern for Lucid Agent

This document defines the standard architecture pattern for all services in Lucid Agent. Following this pattern ensures consistency, testability, and maintainability across the codebase.

---

## Overview

Lucid Agent uses a **layered architecture** with clear separation of concerns:

```
┌─────────────────────────────────────────────┐
│         HTTP Request (from client)          │
└─────────────────────────────────────────────┘
                     ↓
┌─────────────────────────────────────────────┐
│          ROUTE LAYER (routes/)              │
│  - HTTP concerns (req/res)                  │
│  - Input validation (Zod schemas)           │
│  - Error handling (HTTP status codes)       │
│  - Thin: delegates to service layer         │
└─────────────────────────────────────────────┘
                     ↓
┌─────────────────────────────────────────────┐
│        SERVICE LAYER (services/)            │
│  - Business logic                           │
│  - Data transformation                      │
│  - Reusable across routes/jobs              │
│  - Database-agnostic                        │
└─────────────────────────────────────────────┘
                     ↓
┌─────────────────────────────────────────────┐
│         DATABASE LAYER (db.ts)              │
│  - PostgreSQL connection pool               │
│  - Raw SQL queries                          │
│  - Vector operations                        │
└─────────────────────────────────────────────┘
```

---

## File Structure

Each feature should follow this structure:

```
src/
├── validation/
│   └── user.validation.ts       # Zod schemas for input validation
├── services/
│   ├── user.service.ts          # Business logic
│   └── user.service.test.ts     # Unit tests (mocked)
├── routes/
│   ├── users.ts                 # HTTP endpoints
│   └── users.test.ts            # Integration tests (supertest)
└── types/
    └── database.ts              # TypeScript types
```

---

## Layer 1: Validation (validation/)

**Purpose**: Define and validate all input/output shapes using Zod.

**Example**: `src/validation/user.validation.ts`

```typescript
import { z } from 'zod';

// Define schema for creating a user
export const createUserSchema = z.object({
  external_id: z
    .string()
    .min(1, 'external_id is required')
    .regex(/^[a-zA-Z0-9_-]+$/, 'Only alphanumeric, hyphens, and underscores'),

  name: z.string().max(255).optional(),

  email: z.string().email('Invalid email').optional(),

  timezone: z.string()
    .refine((tz) => {
      try {
        Intl.DateTimeFormat(undefined, { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    }, { message: 'Invalid timezone' })
    .default('UTC'),
});

// Export type inference for TypeScript
export type CreateUserInput = z.infer<typeof createUserSchema>;
```

**Key Principles**:
- ✅ One schema per operation (create, update, etc.)
- ✅ Export TypeScript types using `z.infer`
- ✅ Provide clear error messages
- ✅ Use `.optional()`, `.default()`, `.refine()` as needed
- ✅ Validate data types, formats, and business rules

---

## Layer 2: Service (services/)

**Purpose**: Encapsulate all business logic and database operations.

**Example**: `src/services/user.service.ts`

```typescript
import { Pool } from 'pg';
import { logger } from '../logger';
import { CreateUserInput } from '../validation/user.validation';

export interface User {
  id: string;
  external_id: string;
  name: string | null;
  email: string | null;
  timezone: string;
  preferences: Record<string, any>;
  created_at: Date;
  last_active_at: Date;
}

export class UserService {
  constructor(private pool: Pool) {}

  async createOrUpdateUser(input: CreateUserInput): Promise<User> {
    try {
      const result = await this.pool.query(
        `INSERT INTO users (external_id, name, email, timezone)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (external_id)
         DO UPDATE SET name = EXCLUDED.name, email = EXCLUDED.email
         RETURNING *`,
        [input.external_id, input.name || null, input.email || null, input.timezone]
      );

      const user = result.rows[0];
      logger.info(`User created: ${user.id}`);
      return user;
    } catch (error: any) {
      logger.error('Error creating user:', error);
      throw new Error(`Failed to create user: ${error.message}`);
    }
  }

  async findByExternalId(external_id: string): Promise<User | null> {
    // Implementation...
  }
}
```

**Key Principles**:
- ✅ Export clear TypeScript interfaces
- ✅ Inject dependencies via constructor (Pool, etc.)
- ✅ Return domain objects, not raw database results
- ✅ Log important operations
- ✅ Throw descriptive errors
- ✅ Keep methods focused (single responsibility)
- ✅ Use async/await consistently

---

## Layer 3: Routes (routes/)

**Purpose**: Handle HTTP concerns and delegate to services.

**Example**: `src/routes/users.ts`

```typescript
import { Router, Request, Response } from 'express';
import { pool } from '../db';
import { UserService } from '../services/user.service';
import { createUserSchema } from '../validation/user.validation';
import { z } from 'zod';

const router = Router();
const userService = new UserService(pool);

// Validation middleware
function validateBody(schema: z.ZodSchema) {
  return (req: Request, res: Response, next: Function) => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: 'Validation failed',
          details: error.errors.map((err) => ({
            field: err.path.join('.'),
            message: err.message,
          })),
        });
      }
      next(error);
    }
  };
}

// Route handler
router.post('/', validateBody(createUserSchema), async (req: Request, res: Response) => {
  try {
    const user = await userService.createOrUpdateUser(req.body);
    res.status(201).json(user);
  } catch (error: any) {
    logger.error('Error in POST /v1/users:', error);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

export default router;
```

**Key Principles**:
- ✅ Keep route handlers **thin** (5-15 lines max)
- ✅ Validate input with middleware
- ✅ Delegate business logic to services
- ✅ Return appropriate HTTP status codes
- ✅ Handle errors gracefully
- ✅ Document routes with JSDoc comments

---

## Testing Strategy

### Unit Tests (services/)

Test business logic in isolation using mocks.

**Example**: `src/services/user.service.test.ts`

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UserService } from './user.service';
import { Pool } from 'pg';

const mockPool = {
  query: vi.fn(),
} as unknown as Pool;

describe('UserService', () => {
  let userService: UserService;

  beforeEach(() => {
    vi.clearAllMocks();
    userService = new UserService(mockPool);
  });

  it('should create a user with valid input', async () => {
    const input = { external_id: 'test_123', timezone: 'UTC' };
    const mockUser = { id: 'uuid', ...input };

    vi.mocked(mockPool.query).mockResolvedValueOnce({
      rows: [mockUser],
      rowCount: 1,
    } as any);

    const result = await userService.createOrUpdateUser(input);

    expect(result).toEqual(mockUser);
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO users'),
      expect.arrayContaining([input.external_id])
    );
  });
});
```

### Integration Tests (routes/)

Test HTTP endpoints using supertest.

**Example**: `src/routes/users.test.ts`

```typescript
import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import express, { Express } from 'express';
import usersRouter from './users';

vi.mock('../db', () => ({
  pool: { query: vi.fn() },
}));

describe('Users API Routes', () => {
  let app: Express;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use('/v1/users', usersRouter);
    vi.clearAllMocks();
  });

  it('should create a user with valid input', async () => {
    const input = { external_id: 'test_123' };
    const mockUser = { id: 'uuid', ...input };

    vi.mocked(pool.query).mockResolvedValueOnce({
      rows: [mockUser],
      rowCount: 1,
    } as any);

    const response = await request(app)
      .post('/v1/users')
      .send(input);

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ external_id: input.external_id });
  });
});
```

**Key Principles**:
- ✅ Unit tests: Mock dependencies, test logic
- ✅ Integration tests: Mock database, test HTTP layer
- ✅ Aim for 80%+ code coverage
- ✅ Test happy paths AND error cases
- ✅ Use descriptive test names
- ✅ Keep tests independent (no shared state)

---

## Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage

# Run tests with UI
npm run test:ui
```

---

## Creating a New Feature

Follow these steps to add a new feature (e.g., "conversations"):

### Step 1: Create Validation Schema
```bash
touch src/validation/conversation.validation.ts
```

Define Zod schemas for all operations (create, update, etc.)

### Step 2: Create Service
```bash
touch src/services/conversation.service.ts
touch src/services/conversation.service.test.ts
```

Implement business logic and write unit tests.

### Step 3: Create Routes
```bash
touch src/routes/conversations.ts
touch src/routes/conversations.test.ts
```

Create HTTP endpoints and write integration tests.

### Step 4: Register Routes
In `src/index.ts`:
```typescript
import conversationsRouter from './routes/conversations';
app.use('/v1/conversations', conversationsRouter);
```

### Step 5: Run Tests
```bash
npm test
```

All tests should pass before committing.

---

## Best Practices

### DO ✅
- Write tests **before** or **alongside** implementation
- Use TypeScript types everywhere
- Log important operations (info level)
- Log errors with context (error level)
- Validate all user input
- Return specific error messages
- Use dependency injection
- Keep functions small and focused
- Document complex logic with comments

### DON'T ❌
- Put business logic in routes
- Skip input validation
- Ignore errors or swallow exceptions
- Use `any` type unless absolutely necessary
- Mix database queries with HTTP concerns
- Write tests after the fact
- Commit code without tests
- Use magic numbers or strings

---

## Example: Complete Feature Implementation

See the **User** feature as the reference implementation:

```
src/
├── validation/
│   └── user.validation.ts       ✅ Complete
├── services/
│   ├── user.service.ts          ✅ Complete
│   └── user.service.test.ts     ✅ 23 tests passing
├── routes/
│   ├── users.ts                 ✅ Complete
│   └── users.test.ts            ✅ 17 tests passing
```

**Total: 40 tests, 100% passing**

This is the gold standard. All future features should follow this pattern.

---

## Summary

| Layer | Purpose | Location | Testing |
|-------|---------|----------|---------|
| **Validation** | Define data shapes | `validation/*.validation.ts` | Tested via routes |
| **Service** | Business logic | `services/*.service.ts` | Unit tests (mocked) |
| **Routes** | HTTP endpoints | `routes/*.ts` | Integration tests (supertest) |

**Remember**: Build incrementally. Validate often. Test everything. Document clearly.

---

**Next Steps**: Apply this pattern to Conversations, Messages, Facts, and all other features in Phase 2.

# Lucid Agent - Setup Guide

This guide will walk you through setting up Lucid Agent from scratch.

## Step 1: Create Supabase Project

### 1.1 Sign up and create project

1. Go to [supabase.com](https://supabase.com)
2. Sign in or create an account
3. Click **"New Project"**
4. Fill in:
   - **Name**: `lucid-agent`
   - **Database Password**: (generate a strong password - SAVE THIS!)
   - **Region**: Choose closest to you
   - **Pricing Plan**: Free tier works fine for development

5. Click **"Create new project"** and wait 2-3 minutes

### 1.2 Get your credentials

Once the project is ready:

1. Go to **Settings** (gear icon) > **API**
2. Copy these values (you'll need them later):
   - **Project URL**: `https://xxxxx.supabase.co`
   - **anon public**: `eyJhbG...` (for client-side, not critical for Lucid)
   - **service_role**: `eyJhbG...` (CRITICAL - use this for server)

3. Go to **Settings** > **Database**
4. Scroll to **Connection string** > **URI**
5. Copy the URI and replace `[YOUR-PASSWORD]` with your database password
   - Should look like: `postgresql://postgres:yourpass@db.xxxxx.supabase.co:5432/postgres`

### 1.3 Initialize the database

1. In Supabase, go to **SQL Editor**
2. Create a new query
3. Copy the entire contents of `schema.sql` from the lucid-agent project
4. Paste into the SQL editor
5. Click **"Run"** (or press Cmd/Ctrl + Enter)

You should see: `Success. No rows returned`

6. Verify tables were created:
   ```sql
   SELECT table_name
   FROM information_schema.tables
   WHERE table_schema = 'public';
   ```

   You should see:
   - users
   - conversations
   - messages
   - facts
   - evidence
   - summaries
   - personality_snapshots
   - autonomous_thoughts
   - research_tasks
   - agent_jobs

7. Verify pgvector extension:
   ```sql
   SELECT * FROM pg_extension WHERE extname = 'vector';
   ```

   You should see one row with `vector` extension.

---

## Step 2: Set Up Local Environment

### 2.1 Install dependencies

```bash
cd /Users/mattdarbro/Desktop/lucid-agent
npm install
```

### 2.2 Create .env file

```bash
cp .env.example .env
```

### 2.3 Fill in .env with your credentials

Open `.env` in your editor and fill in:

```bash
# Server
PORT=4000
NODE_ENV=development

# Supabase (from Step 1.2)
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_ANON_KEY=eyJhbG... (the anon public key)
SUPABASE_SERVICE_KEY=eyJhbG... (the service_role key - IMPORTANT!)

# Database (from Step 1.2)
DATABASE_URL=postgresql://postgres:yourpass@db.xxxxx.supabase.co:5432/postgres

# OpenAI (get from platform.openai.com)
OPENAI_API_KEY=sk-...

# Studio API (from your existing studio-api project)
STUDIO_API_URL=http://localhost:3000
STUDIO_APP_KEY=your-app-key-from-studio-api-env-file

# Rest can stay as defaults for now
```

### 2.4 Test the connection

```bash
npm run dev
```

You should see:
```
[INFO] Configuration validated successfully
[INFO] Testing database connection...
[INFO] Database connection successful: 2025-11-03T...
[INFO] 🧠 Lucid agent running on 0.0.0.0:4000
[INFO] 📊 Health: http://localhost:4000/health
[INFO] ℹ️  Info: http://localhost:4000/info
[INFO] 🔗 Studio API: http://localhost:3000
[INFO] 🤖 Autonomous agents: ENABLED
[INFO] 💭 Dreams: ENABLED
```

If you see errors, check:
- Database credentials are correct
- OpenAI API key is valid
- studio-api is running on port 3000

---

## Step 3: Verify Everything Works

### 3.1 Test health endpoint

```bash
curl http://localhost:4000/health
```

Should return:
```json
{
  "status": "ok",
  "timestamp": "2025-11-03T..."
}
```

### 3.2 Test info endpoint

```bash
curl http://localhost:4000/info
```

Should return:
```json
{
  "agent": "Lucid",
  "features": {
    "autonomousAgents": true,
    "webResearch": false,
    "dreams": true
  },
  "studioApi": "http://localhost:3000",
  "version": "1.0.0"
}
```

---

## Step 4: Deploy to Railway (Optional)

### 4.1 Initialize git repo

```bash
cd /Users/mattdarbro/Desktop/lucid-agent
git init
git add .
git commit -m "Initial commit: Lucid Agent foundation"
```

### 4.2 Push to GitHub

Create a new repo on GitHub, then:

```bash
git remote add origin https://github.com/yourusername/lucid-agent.git
git branch -M main
git push -u origin main
```

### 4.3 Deploy to Railway

1. Go to [railway.app](https://railway.app)
2. Click **"New Project"**
3. Choose **"Deploy from GitHub repo"**
4. Select your `lucid-agent` repository
5. Railway will auto-detect Node.js and use `package.json` scripts

### 4.4 Add environment variables

In Railway project settings > **Variables**, add all variables from your `.env`:

- `PORT` = 4000
- `NODE_ENV` = production
- `SUPABASE_URL` = ...
- `SUPABASE_SERVICE_KEY` = ...
- `DATABASE_URL` = ...
- `OPENAI_API_KEY` = ...
- `STUDIO_API_URL` = (your deployed studio-api URL)
- `STUDIO_APP_KEY` = ...
- All other vars from .env

### 4.5 Deploy

Railway will automatically build and deploy. Check the logs to ensure it started successfully.

---

## Step 5: Next Steps

Now that the foundation is set up, you can:

1. **Test with your iOS app** (once we implement the chat endpoint)
2. **Migrate your existing iOS memory data** to Supabase
3. **Continue building features**:
   - Memory services
   - Streaming chat
   - Autonomous agents
   - etc.

---

## Troubleshooting

### Database connection fails

**Error**: `Connection refused` or `Could not connect to server`

**Fix**:
- Check `DATABASE_URL` is correct
- Verify Supabase project is running (not paused)
- Check your IP is allowed (Supabase > Settings > Database > Connection pooling)

### OpenAI errors

**Error**: `Invalid API key`

**Fix**:
- Get a new key from [platform.openai.com/api-keys](https://platform.openai.com/api-keys)
- Make sure key starts with `sk-`
- Check you have credits in your OpenAI account

### Port already in use

**Error**: `EADDRINUSE`

**Fix**:
```bash
# Find what's using port 4000
lsof -i :4000

# Kill it
kill -9 [PID]

# Or change PORT in .env to something else like 4001
```

### TypeScript errors

**Error**: Module not found

**Fix**:
```bash
# Reinstall dependencies
rm -rf node_modules package-lock.json
npm install

# Rebuild
npm run build
```

---

## Support

If you encounter issues:

1. Check the logs for detailed error messages
2. Verify all environment variables are set correctly
3. Test database connection with Supabase SQL editor
4. Make sure studio-api is running

---

**You're ready to build an autonomous AI agent!** 🧠✨

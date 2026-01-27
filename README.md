# PM Daily Digest Agent

A feedback analysis system that automatically processes user feedback, groups similar issues together, and sends you a prioritized daily digest. Critical issues get sent immediately via Telegram.

## Live Deployment

**Main URL:** https://cf-feedback-agent.udupanavya19.workers.dev

**Key Endpoints:**
- **Web View (Digest):** https://cf-feedback-agent.udupanavya19.workers.dev/view
- **JSON API:** https://cf-feedback-agent.udupanavya19.workers.dev/digest
- **Seed Data:** `POST https://cf-feedback-agent.udupanavya19.workers.dev/seed`
- **Run Digest:** `POST https://cf-feedback-agent.udupanavya19.workers.dev/run`
- **Run Digest:** `POST https://cf-feedback-agent.udupanavya19.workers.dev/view`

## How to Use This (For Your Team)

### View the Latest Digest

**Option 1: Web Browser (Easiest)**
- Just open: https://cf-feedback-agent.udupanavya19.workers.dev/view
- Shows the same digest that gets sent to Telegram
- Refresh the page to see the latest version

**Option 2: JSON API**
- Open: https://cf-feedback-agent.udupanavya19.workers.dev/digest
- Returns the digest data as JSON (for integrations)

### Submit New Feedback

Send feedback to the system via API:

```bash
curl -X POST https://cf-feedback-agent.udupanavya19.workers.dev/feedback \
  -H "Content-Type: application/json" \
  -d '{
    "content": "App crashes when I try to login",
    "source": "support",
    "user": "user123"
  }'
```

**What happens:**
- If it's a critical issue (crash, payment problem, etc.) → You get an instant Telegram alert
- Otherwise → It gets added to tomorrow's morning digest

### Daily Digest

The system automatically runs every morning at 9am PT and sends you:
- Top prioritized issues (grouped by similarity)
- Individual support cases that need personal attention
- Positive feedback (what's working well)

You'll receive this via:
- **Telegram** (if configured)
- **Web view** at `/view` endpoint

### Testing / Demo

To test with sample data:

```bash
# Load sample feedback
curl -X POST https://cf-feedback-agent.udupanavya19.workers.dev/seed

# Generate digest immediately (don't wait for 9am)
curl -X POST https://cf-feedback-agent.udupanavya19.workers.dev/run

# view the results on website
curl -X POST https://cf-feedback-agent.udupanavya19.workers.dev/view
```

Then check `/view` to see the results.

## What It Does

### Instant Alerts
When critical issues come in (crashes, payment failures, data loss), you get notified immediately via Telegram. No waiting.

### Morning Digest
Every day at 9am PT, you get a digest with:
- **Issues** - Grouped and prioritized (P0 = critical, P1 = high, P2 = normal, P3 = low)
- **Individual Support Cases** - User-specific issues that need personal follow-up
- **What's Working Well** - Positive feedback from users

The system automatically:
- Groups similar feedback together (so "app crashes" and "app force closes" become one issue)
- Calculates priority based on severity, how many people reported it, how recent it is
- Suggests actions (bug fix, UX improvement, etc.)

## Technical Details

Built on Cloudflare Workers using:
- **Workers** - API endpoints
- **D1 Database** - Stores all feedback and analysis
- **Workers AI** - Analyzes and summarizes feedback
- **Cron Triggers** - Runs daily at 9am PT

## API Endpoints

- `GET /` - List all endpoints
- `POST /feedback` - Submit feedback
- `POST /seed` - Load test data
- `POST /run` - Generate digest manually
- `GET /digest` - Get latest digest (JSON)
- `GET /view` - View latest digest (web page)
- `POST /reset` - Clear all data (for testing)

## Setup (For Developers)

### Prerequisites
- Node.js installed
- Cloudflare account
- Telegram bot (for notifications)

### Quick Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Create D1 database:**
   ```bash
   npx wrangler d1 create feedback-db2
   ```
   Copy the `database_id` and update `wrangler.jsonc` line 23.

3. **Run migrations:**
   ```bash
   npx wrangler d1 migrations apply feedback-db2 --local
   npx wrangler d1 migrations apply feedback-db2 --remote
   ```

4. **Configure secrets:**
   Edit `src/config.ts` with your Telegram bot token and chat ID.

5. **Deploy:**
   ```bash
   npm run deploy
   ```

### Local Development

```bash
npm run dev
```

Then access at `http://localhost:8787`

## How Priority Works

Issues are scored based on:
- **Severity** (55%) - How bad is it? Crash = P0, minor bug = P2
- **Frequency** (25%) - How many people reported it?
- **Recency** (10%) - How recently was it reported?
- **Sentiment** (10%) - How negative is the feedback?

**Priority Levels:**
- **P0** (Score ≥ 70) - Critical, fix immediately
- **P1** (Score ≥ 50) - High priority
- **P2** (Score ≥ 30) - Normal priority
- **P3** (Score < 30) - Low priority / enhancements

## Database Schema

- `feedback` - Raw feedback entries
- `feedback_analysis` - AI analysis results
- `clusters` - Grouped similar feedbacks
- `cluster_members` - Which feedbacks belong to which cluster
- `digests` - Generated daily reports

## Notes

- The system automatically deduplicates similar feedback
- Critical issues (P0) trigger instant alerts
- Everything else goes into the morning digest
- All data is stored in Cloudflare D1 (serverless SQL database)

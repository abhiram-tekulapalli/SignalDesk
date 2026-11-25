# SignalDesk — Your Daily Intelligence Briefing

![License](https://img.shields.io/badge/License-MIT-blue.svg)
![Platform](https://img.shields.io/badge/Platform-Google%20Apps%20Script-green.svg)
![Runtime](https://img.shields.io/badge/Runtime-V8-yellow.svg)
![Cost](https://img.shields.io/badge/Cost-Free%20Tier-brightgreen.svg)
![Privacy](https://img.shields.io/badge/Gmail-Read--Only%20Only-orange.svg)
![Gemini](https://img.shields.io/badge/AI-Gemini%20Developer%20API-8A4FFF.svg)
![Telegram](https://img.shields.io/badge/Delivery-Telegram%20Bot%20API-0088CC.svg)
![Schedule](https://img.shields.io/badge/Schedule-Dual%20Shift%20%7E7AM%2F9%3A30PM%20IST-purple.svg)

**SignalDesk** is a zero-cost, personal AI-powered newsletter intelligence system that runs **100% on Google Apps Script (V8)** — using the **Gmail API (read-only)**, **Gemini Developer API**, **Google Sheets**, and the **Telegram Bot API**.

No servers, no React/Node backend, no paid hosting, and no inbox clutter. Every morning around **7:00 AM** and every night around **9:30 PM** (`Asia/Kolkata`, configurable), SignalDesk gathers unread editions from your approved newsletter publishers, removes boilerplate and tracking clutter, runs **one structured Gemini API call** to deduplicate, categorize, rank, and summarize the day's developments, verifies every URL against the source emails, and delivers a clean editorial briefing privately to your Telegram chat.

> **Ready to deploy?** Follow the complete step-by-step installation guide in **[SETUP.md](./SETUP.md)**.

---

## Key Features

- **Zero-Cost Serverless Runtime**: Runs completely inside your own Google account on Google Apps Script (V8) + Google Sheets + free-tier Gemini Developer API + Telegram Bot API.
- **Dual Daily Shifts (Morning + Night Recap)**:
  - **Morning Briefing (~7:00 AM IST)**: Summarizes overnight newsletters before you start your day.
  - **Night Recap (~9:30 PM IST)**: Captures afternoon/evening newsletters (such as US morning editions like TLDR) the same day — stays silent by default if nothing new arrived.
- **Zero-Hallucination Link Grounding**: Every story URL, quick-byte link, rabbit-hole resource, and hero image URL returned by Gemini is verified against an allowlist extracted from the original emails. Invented links are stripped automatically.
- **Read-Only Gmail Privacy**: Uses `gmail.readonly` only. SignalDesk never deletes, archives, modifies, or labels emails in your mailbox.
- **Cross-Day Deduplication & Editorial Ranking**: Merges duplicate stories covered by multiple publishers in the same batch, suppresses repeated stories from the last 4 days without blocking brand-new developments for known companies/topics, and selects the top 5–8 stories plus 3–5 Quick Bytes across 7 categories.
- **Premium Telegram Editorial Layout**: Escaped Telegram HTML with 6 structured sections (*Top Stories*, *Quick Bytes*, *The Big Picture*, *Concept of the Day*, *Rabbit Hole*, and a `<tg-spoiler>` *Micro Quiz*), optional hero image with non-fatal fallback, and boundary-safe message splitting under Telegram's 4,096-character limit.
- **Automatic 7-Day Rolling Sheet Retention**: Automatically clears rows older than 7 days (`RETENTION_DAYS`) from `SeenEmails`, `Stories`, and `Runs` while preserving your `Sources` tab and headers indefinitely.
- **Failure Recovery & Idempotency**: Emails are only marked `SUCCESS` after Telegram confirms delivery. Failed runs remain recoverable on the next cycle, and `ScriptLock` prevents overlapping executions.

---

## Architecture & Data Flow

```text
Dedicated Gmail (Label: SignalDesk/Source · gmail.readonly)
        │
        ▼
[GmailService.gs]     ──► Filter by enabled rows in SignalDesk_DB -> Sources
        │                 Skip SUCCESS message IDs (SeenEmails); retry FAILED IDs
        ▼
[EmailParser.gs]      ──► Recursive MIME decode (byte-array & base64url safe)
        │                 Extract headlines, unwrap tracking links, score hero images
        ▼
[ContentCleaner.gs]   ──► Strip footers, nav bars, tracking pixels & sponsor clutter
        │                 Sanitize untrusted text; budget 12 emails / 48,000 chars
        ▼
[PromptBuilder.gs]    ──► Wrap batch in <UNTRUSTED_NEWSLETTER_BATCH> + 4-day history
        │                 Apply Morning Briefing or Night Recap editorial framing
        ▼
[GeminiService.gs]    ──► 1 primary UrlFetchApp POST (x-goog-api-key header)
        │                 Strict JSON output via responseSchema (no Search Grounding)
        ▼
[DigestValidator.gs]  ──► Validate schema, 7 categories & URL/image allowlist grounding
        │
        ▼
[Deduplication.gs]    ──► Intra-edition consolidation + 4-day cross-day dedup
        │
        ▼
[Ranking.gs]          ──► Composite editorial score + category diversity -> Top 5–8 + Quick Bytes
        │
        ▼
[DigestFormatter.gs]  ──► Escape HTML, format 6 sections + <tg-spoiler> quiz, split <= 4,000 chars
        │
        ▼
[TelegramService.gs]  ──► sendPhoto (optional hero image, non-fatal fallback) + sendMessage
        │
        ▼
[StorageService.gs]   ──► Mark SeenEmails = SUCCESS, append Stories, log Runs, prune > 7 days
```

---

## Repository File Structure

All Apps Script files live side-by-side at the root so you can copy them directly into [script.google.com](https://script.google.com) or push with `clasp`.

```text
SignalDesk/
├── README.md             # Project overview, architecture, database schema & reference
├── SETUP.md              # Step-by-step setup, Gmail filters, Telegram Bot, testing & fixes
├── appsscript.json       # V8 runtime, Asia/Kolkata TZ, Gmail API v1, least-privilege scopes
├── Config.gs             # Script Properties loader, defaults, 7 categories & validation
├── Main.gs               # Orchestrator, setup, triggers, backfill, dry-run & test suite
├── GmailService.gs       # Read-only Gmail API v1 label lookup & approved-sender filtering
├── EmailParser.gs        # Nested MIME parser (byte array + base64url), links & image scoring
├── ContentCleaner.gs     # Boilerplate/sponsor stripping, injection hygiene & char budgeting
├── PromptBuilder.gs      # Morning/Night editorial prompt & strict Gemini responseSchema
├── GeminiService.gs      # Single UrlFetchApp Gemini call, backoff retry & JSON parser
├── DigestValidator.gs    # Strict schema enforcement & zero-hallucination URL verifier
├── Deduplication.gs      # URL normalization, headline/entity matching & date-scoped keys
├── Ranking.gs            # Editorial scoring, category diversity & edition curation
├── DigestFormatter.gs    # 6-section Telegram HTML formatter, escaping & safe chunk splitter
├── TelegramService.gs    # Telegram Bot API sendMessage/sendPhoto with 429 retry & fallback
├── StorageService.gs     # SignalDesk_DB Sheets initialization, CRUD & 7-day retention pruning
├── Scheduler.gs          # Idempotent Morning + Night IST triggers & ScriptLock guard
└── Logger.gs             # Structured execution logs with automatic secret/token redaction
```

---

## Content Categories

Stories and Quick Bytes are normalized into seven editorial domains:

1. `AI & Machine Learning`
2. `Technology & Startups`
3. `Programming & Developer Tools`
4. `Science & Research`
5. `Cybersecurity`
6. `Interesting Discoveries & Internet Trends`
7. `Business & Finance`

---

## Database Schema (`SignalDesk_DB`)

`setupSignalDesk()` automatically creates a private Google Sheet named **`SignalDesk_DB`** with four tabs:

| Tab | Purpose | Retention |
|---|---|---|
| **`Sources`** | Approved newsletter publishers (`source_id`, `publisher`, `sender_email`, `category`, `reliability_notes`, `enabled`, `subscribed_at`). Supports exact emails (`dan@tldrnewsletter.com`) or domain wildcards (`@tldrnewsletter.com`). | Permanent (never pruned) |
| **`SeenEmails`** | Tracks every processed Gmail `message_id` (`SUCCESS`, `FAILED`, `SKIPPED_EMPTY`) to prevent duplicates and recover failed runs. | Auto-pruned after `RETENTION_DAYS` (default `7`) |
| **`Stories`** | Stores curated stories, source URLs, publishers, and date-scoped `duplicate_key` fingerprints for cross-day deduplication. | Auto-pruned after `RETENTION_DAYS` (default `7`) |
| **`Runs`** | Audit trail of every execution (`emails_fetched`, `emails_processed`, `stories_detected`, `stories_selected`, `gemini_status`, `telegram_status`, `execution_time`, `error_message`). | Auto-pruned after `RETENTION_DAYS` (default `7`) |

---

## Main Entry Points (Apps Script Editor)

Run any of these directly from the function dropdown in `script.google.com`:

| Function | What It Does |
|---|---|
| `setupSignalDesk()` | Seeds default non-secret properties, creates `SignalDesk_DB`, and installs Morning + Night triggers. |
| `runMorningDigest()` | Scheduled Morning Briefing (`~7:00 AM IST`). |
| `runNightRecap()` | Scheduled Night Recap (`~9:30 PM IST`). Silent if no new emails arrived. |
| `runDailyDigest()` | Manual end-to-end production run (auto-selects Morning or Night edition based on local hour). |
| `runBackfillPreviousDays(days)` | Collects unprocessed approved newsletters from the past 5 days (clamped to `RETENTION_DAYS`). |
| `cleanupOldRecords()` | Manually deletes rows older than `RETENTION_DAYS` from `SeenEmails`, `Stories`, and `Runs`. |
| `runDryRun()` | Runs full Gmail extraction, Gemini synthesis, and Telegram formatting in logs **without** messaging Telegram or mutating `SignalDesk_DB`. |
| `testMockEndToEndToTelegram()` | Sends a test briefing to Telegram using built-in mock newsletters through your real Gemini API + Bot without touching `SignalDesk_DB`. |
| `testGmailConnection()` | Verifies Gmail API Advanced Service and `SignalDesk/Source` label resolution. |
| `testMilestone1ExtractOne()` | Extracts and cleans 1 real newsletter from Gmail into structured JSON in Execution Logs. |
| `testGeminiConnection()` | Verifies `GEMINI_API_KEY`, `GEMINI_MODEL`, and structured JSON output. |
| `testTelegramConnection()` | Sends a short verification message to your private Telegram chat. |
| `runOfflineUnitTests()` | Runs 12 self-contained unit tests with zero API keys or external calls. |
| `listSignalDeskTriggers()` | Lists all active Apps Script time-driven triggers installed by SignalDesk. |

---

## OAuth Scopes, Security & Guardrails

### Least-Privilege OAuth Scopes (`appsscript.json`)
- `https://www.googleapis.com/auth/gmail.readonly` — Read-only newsletter access.
- `https://www.googleapis.com/auth/spreadsheets` — Manage your private `SignalDesk_DB` sheet.
- `https://www.googleapis.com/auth/script.external_request` — Call Gemini Developer API and Telegram Bot API via `UrlFetchApp`.
- `https://www.googleapis.com/auth/script.scriptapp` — Manage daily time-driven triggers.

### Security & Platform Safeguards
- **Zero Hardcoded Secrets**: API keys and bot tokens live strictly in **Apps Script Project Settings → Script Properties**. `Logger.gs` automatically redacts secrets, `AIza...` keys, and Telegram `/bot...` URLs before writing logs.
- **Prompt Injection Defense**: Newsletter text is stripped of suspicious directives and wrapped inside `<UNTRUSTED_NEWSLETTER_BATCH>` delimiters.
- **6-Minute Execution Ceiling**: Enforces a 5-minute soft execution budget (`EXECUTION_BUDGET_MS`), a 12-email / 48,000-character batch cap, and 1 primary Gemini call per run.
- **Free-Tier Privacy Notice**: Google's Gemini API free tier has separate data-use terms. Route **only public newsletters from approved publishers** into `SignalDesk/Source` — never personal or confidential emails.

---

## Setup & Deployment

See **[SETUP.md](./SETUP.md)** for the complete 10-minute walkthrough covering Gmail filters, Apps Script setup, Telegram Bot & Chat ID creation, Script Properties, phased testing, schedule tuning, and troubleshooting.

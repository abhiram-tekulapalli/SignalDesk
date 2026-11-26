# SignalDesk — Your Daily Intelligence Briefing

<p align="center">
  <img src="https://raw.githubusercontent.com/abhiram-tekulapalli/project_readme_assets/main/header.svg" alt="SignalDesk" width="100%" />
</p>

<p align="center">
  <a href="https://developers.google.com/apps-script"><img src="https://img.shields.io/badge/Google%20Apps%20Script-V8-4285F4?style=for-the-badge&logo=google&logoColor=white" alt="Google Apps Script"></a>
  <a href="https://developers.google.com/gmail/api"><img src="https://img.shields.io/badge/Gmail%20API-Read--Only-EA4335?style=for-the-badge&logo=gmail&logoColor=white" alt="Gmail API"></a>
  <a href="https://ai.google.dev"><img src="https://img.shields.io/badge/Gemini%20API-Developer-4285F4?style=for-the-badge&logo=google&logoColor=white" alt="Gemini API"></a>
  <a href="https://core.telegram.org/bots/api"><img src="https://img.shields.io/badge/Telegram%20Bot%20API-0088CC?style=for-the-badge&logo=telegram&logoColor=white" alt="Telegram Bot API"></a>
  <a href="https://www.google.com/sheets/about/"><img src="https://img.shields.io/badge/Google%20Sheets-Database-34A853?style=for-the-badge&logo=googlesheets&logoColor=white" alt="Google Sheets"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge" alt="License"></a>
  <a href="#"><img src="https://img.shields.io/badge/Cost-Free%20Tier-brightgreen?style=for-the-badge" alt="Free Tier"></a>
  <a href="#"><img src="https://img.shields.io/badge/Schedule-Dual%20Shift%207AM%2F9%3A30PM%20IST-purple?style=for-the-badge" alt="Schedule"></a>
</p>

---

## 🎯 Overview

**SignalDesk** is a zero-cost, personal AI-powered newsletter intelligence system that runs **100% on Google Apps Script (V8)** — using the **Gmail API (read-only)**, **Gemini Developer API**, **Google Sheets**, and the **Telegram Bot API**.

No servers, no React/Node backend, no paid hosting, and no inbox clutter. Every morning around **7:00 AM** and every night around **9:30 PM** (`Asia/Kolkata`, configurable), SignalDesk gathers unread editions from your approved newsletter publishers, removes boilerplate and tracking clutter, runs **one structured Gemini API call** to deduplicate, categorize, rank, and summarize the day's developments, verifies every URL against the source emails, and delivers a clean editorial briefing privately to your Telegram chat.

> **Ready to deploy?** Follow the complete step-by-step installation guide in **[SETUP.md](./SETUP.md)**.

---

## ✨ Key Features

| Feature | Description |
|---------|-------------|
| 💰 **Zero-Cost Serverless** | Runs entirely in your Google account — Apps Script (V8) + Sheets + free-tier Gemini + Telegram Bot API |
| 🌅 **Dual Daily Shifts** | **Morning Briefing (~7:00 AM IST)** — overnight newsletters • **Night Recap (~9:30 PM IST)** — afternoon/evening editions (US morning news like TLDR) |
| 🔗 **Zero-Hallucination Link Grounding** | Every story URL, quick-byte link, rabbit-hole resource, and hero image verified against source email allowlist |
| 🔒 **Read-Only Gmail Privacy** | `gmail.readonly` only — never deletes, archives, modifies, or labels emails |
| 🧹 **Cross-Day Deduplication** | Merges duplicates from same batch, suppresses repeats from last 4 days without blocking new developments |
| 📱 **Premium Telegram Layout** | 6 structured sections (*Top Stories*, *Quick Bytes*, *The Big Picture*, *Concept of the Day*, *Rabbit Hole*, *Micro Quiz* in `<tg-spoiler>`), optional hero image, safe chunk splitting under 4,096 chars |
| 🗄️ **7-Day Rolling Retention** | Auto-clears `SeenEmails`, `Stories`, `Runs` older than 7 days; preserves `Sources` tab indefinitely |
| 🔄 **Failure Recovery & Idempotency** | Emails marked `SUCCESS` only after Telegram confirms delivery; `ScriptLock` prevents overlapping executions |

---

## 🏗️ Architecture & Data Flow

```text
Dedicated Gmail (Label: SignalDesk/Source · gmail.readonly)
        │
        ▼
[GmailService.gs]     ──► Filter by enabled rows in SignalDesk_DB → Sources
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
[Ranking.gs]          ──► Composite editorial score + category diversity → Top 5–8 + Quick Bytes
        │
        ▼
[DigestFormatter.gs]  ──► Escape HTML, format 6 sections + <tg-spoiler> quiz, split ≤ 4,000 chars
        │
        ▼
[TelegramService.gs]  ──► sendPhoto (optional hero image, non-fatal fallback) + sendMessage
        │
        ▼
[StorageService.gs]   ──► Mark SeenEmails = SUCCESS, append Stories, log Runs, prune > 7 days
```

---

## 📂 Repository Structure

All Apps Script files live side-by-side at the root for direct copy into [script.google.com](https://script.google.com) or `clasp` push.

| File | Purpose |
|------|---------|
| `README.md` | Project overview, architecture, database schema & reference |
| `SETUP.md` | Step-by-step setup, Gmail filters, Telegram Bot, testing & fixes |
| `appsscript.json` | V8 runtime, Asia/Kolkata TZ, Gmail API v1, least-privilege scopes |
| `Config.gs` | Script Properties loader, defaults, 7 categories & validation |
| `Main.gs` | Orchestrator, setup, triggers, backfill, dry-run & test suite |
| `GmailService.gs` | Read-only Gmail API v1 label lookup & approved-sender filtering |
| `EmailParser.gs` | Nested MIME parser (byte array + base64url), links & image scoring |
| `ContentCleaner.gs` | Boilerplate/sponsor stripping, injection hygiene & char budgeting |
| `PromptBuilder.gs` | Morning/Night editorial prompt & strict Gemini responseSchema |
| `GeminiService.gs` | Single UrlFetchApp Gemini call, backoff retry & JSON parser |
| `DigestValidator.gs` | Strict schema enforcement & zero-hallucination URL verifier |
| `Deduplication.gs` | URL normalization, headline/entity matching & date-scoped keys |
| `Ranking.gs` | Editorial scoring, category diversity & edition curation |
| `DigestFormatter.gs` | 6-section Telegram HTML formatter, escaping & safe chunk splitter |
| `TelegramService.gs` | Telegram Bot API sendMessage/sendPhoto with 429 retry & fallback |
| `StorageService.gs` | SignalDesk_DB Sheets initialization, CRUD & 7-day retention pruning |
| `Scheduler.gs` | Idempotent Morning + Night IST triggers & ScriptLock guard |
| `Logger.gs` | Structured execution logs with automatic secret/token redaction |

---

## 📚 Content Categories

Stories and Quick Bytes normalized into seven editorial domains:

1. **AI & Machine Learning**
2. **Technology & Startups**
3. **Programming & Developer Tools**
4. **Science & Research**
5. **Cybersecurity**
6. **Interesting Discoveries & Internet Trends**
7. **Business & Finance**

---

## 🗄️ Database Schema (`SignalDesk_DB`)

`setupSignalDesk()` creates a private Google Sheet **`SignalDesk_DB`** with four tabs:

| Tab | Purpose | Retention |
|-----|---------|-----------|
| **`Sources`** | Approved publishers (`source_id`, `publisher`, `sender_email`, `category`, `reliability_notes`, `enabled`, `subscribed_at`). Exact emails (`dan@tldrnewsletter.com`) or domain wildcards (`@tldrnewsletter.com`). | Permanent |
| **`SeenEmails`** | Tracks every processed Gmail `message_id` (`SUCCESS`, `FAILED`, `SKIPPED_EMPTY`) for deduplication & failed-run recovery. | Auto-pruned after 7 days |
| **`Stories`** | Curated stories, source URLs, publishers, date-scoped `duplicate_key` fingerprints for cross-day dedup. | Auto-pruned after 7 days |
| **`Runs`** | Audit trail: `emails_fetched`, `emails_processed`, `stories_detected`, `stories_selected`, `gemini_status`, `telegram_status`, `execution_time`, `error_message`. | Auto-pruned after 7 days |

---

## 🎮 Main Entry Points (Apps Script Editor)

Run any function from the dropdown in `script.google.com`:

| Function | What It Does |
|----------|--------------|
| `setupSignalDesk()` | Seeds default non-secret properties, creates `SignalDesk_DB`, installs Morning + Night triggers |
| `runMorningDigest()` | Scheduled Morning Briefing (`~7:00 AM IST`) |
| `runNightRecap()` | Scheduled Night Recap (`~9:30 PM IST`) — silent if no new emails |
| `runDailyDigest()` | Manual end-to-end run (auto-selects Morning/Night by local hour) |
| `runBackfillPreviousDays(days)` | Collects unprocessed approved newsletters from past 5 days |
| `cleanupOldRecords()` | Manually deletes rows older than `RETENTION_DAYS` |
| `runDryRun()` | Full Gmail extraction, Gemini synthesis, Telegram formatting in logs **without** messaging or DB writes |
| `testMockEndToEndToTelegram()` | Sends test briefing to Telegram via mock newsletters through real Gemini + Bot |
| `testGmailConnection()` | Verifies Gmail API Advanced Service & `SignalDesk/Source` label resolution |
| `testMilestone1ExtractOne()` | Extracts & cleans 1 real newsletter from Gmail into structured JSON |
| `testGeminiConnection()` | Verifies `GEMINI_API_KEY`, `GEMINI_MODEL`, structured JSON output |
| `testTelegramConnection()` | Sends short verification message to your Telegram chat |
| `runOfflineUnitTests()` | 12 self-contained unit tests, zero API keys or external calls |
| `listSignalDeskTriggers()` | Lists all active Apps Script time-driven triggers |

---

## 🔐 OAuth Scopes, Security & Guardrails

### Least-Privilege OAuth Scopes (`appsscript.json`)

- `https://www.googleapis.com/auth/gmail.readonly` — Read-only newsletter access
- `https://www.googleapis.com/auth/spreadsheets` — Manage private `SignalDesk_DB`
- `https://www.googleapis.com/auth/script.external_request` — Call Gemini API & Telegram Bot API via `UrlFetchApp`
- `https://www.googleapis.com/auth/script.scriptapp` — Manage daily time-driven triggers

### Security Safeguards

- **Zero Hardcoded Secrets** — API keys/tokens in **Script Properties** only; `Logger.gs` auto-redacts secrets
- **Prompt Injection Defense** — Newsletter text stripped of suspicious directives, wrapped in `<UNTRUSTED_NEWSLETTER_BATCH>`
- **Execution Budget** — 5-min soft ceiling (`EXECUTION_BUDGET_MS`), 12-email / 48k-char batch cap, 1 Gemini call per run
- **Free-Tier Privacy Notice** — Route only public newsletters from approved publishers into `SignalDesk/Source` — never personal/confidential emails

---

## 🛠️ Setup & Deployment

See **[SETUP.md](./SETUP.md)** for the complete 10-minute walkthrough covering Gmail filters, Apps Script setup, Telegram Bot & Chat ID creation, Script Properties, phased testing, schedule tuning, and troubleshooting.

---

## 📄 License

MIT License — see [LICENSE](LICENSE) for details.

---

<p align="center">
  <img src="https://raw.githubusercontent.com/abhiram-tekulapalli/project_readme_assets/main/footer.svg" alt="Footer" width="100%" />
</p>
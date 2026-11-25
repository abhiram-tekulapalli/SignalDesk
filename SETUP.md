# SignalDesk — Complete Step-by-Step Setup Guide

This guide walks you through deploying **SignalDesk** on your own Google account in ~10 minutes with **zero recurring cost**.

---

## Prerequisites

1. **A Google / Gmail account** (a dedicated Gmail account for newsletters is strongly recommended so personal email stays isolated).
2. **A free Gemini Developer API key** from [Google AI Studio](https://aistudio.google.com/apikey).
3. **A Telegram account** (mobile or desktop) to receive your private briefings.

---

## Step 1: Create Your Gmail Source Label & Filters

SignalDesk only reads emails carrying a specific Gmail label (default: `SignalDesk/Source`).

1. Open [Gmail](https://mail.google.com).
2. In the left sidebar, click **Labels (`+`)** and create a label named **exactly**:
   ```text
   SignalDesk/Source
   ```
   *(Case-sensitive spelling matters.)*
3. Set up a Gmail filter so incoming newsletters receive this label automatically:
   - Click the **Show search options** slider icon in Gmail's top search bar.
   - In the **From** field, enter your newsletter domains or addresses separated by `OR`, for example:
     ```text
     @tldrnewsletter.com OR @daily.therundown.ai OR @mail.beehiiv.com
     ```
   - Click **Create filter**.
   - Check **Apply the label:** → select **`SignalDesk/Source`**.
   - *(Optional)* Check **Skip the Inbox (Archive it)** to keep your main inbox clean.
   - *(Recommended for first run)* Check **Also apply filter to matching conversations** so existing newsletters get labeled immediately.
   - Click **Create filter**.

---

## Step 2: Create the Google Apps Script Project

1. Go to [script.google.com](https://script.google.com) while signed into the same Gmail account and click **New Project**.
2. Click **Untitled project** at the top and rename it to **`SignalDesk`**.
3. Open **Project Settings** (gear icon on the left sidebar) and enable:
   - Check **"Show `appsscript.json` manifest file in editor"**.
4. Return to the **Editor (`<>`)** view:
   - Click **`appsscript.json`** and replace its contents with the repository's `appsscript.json`.
   - Delete the default empty `Code.gs` file (or rename it to `Main.gs`).
   - Click **`+` → Script** to create each of the **15 `.gs` files** (Apps Script adds `.gs` automatically when you enter the name):
     1. `Config`
     2. `Main`
     3. `GmailService`
     4. `EmailParser`
     5. `ContentCleaner`
     6. `PromptBuilder`
     7. `GeminiService`
     8. `DigestValidator`
     9. `Deduplication`
     10. `Ranking`
     11. `DigestFormatter`
     12. `TelegramService`
     13. `StorageService`
     14. `Scheduler`
     15. `Logger`
   - Paste the exact code from each corresponding `.gs` file in this repository and press **Ctrl+S / Cmd+S** to save.

---

## Step 3: Enable the Gmail API Advanced Service

1. In the Apps Script Editor left sidebar, click **Services (`+`)**.
2. Scroll to **Gmail API**.
3. Keep Version **`v1`** and Identifier **`Gmail`**.
4. Click **Add**.

---

## Step 4: Get Your Free Gemini API Key

1. Visit [aistudio.google.com/apikey](https://aistudio.google.com/apikey).
2. Click **Create API key** on the free tier.
3. Copy the key (`AIza...`). **Never commit or paste this key into any `.gs` file.**

---

## Step 5: Create Your Private Telegram Bot & Get Your Chat ID

### 5A. Create the Bot (`TELEGRAM_BOT_TOKEN`)
1. Open Telegram and search for **`@BotFather`** (verified account).
2. Send `/newbot`.
3. Choose a display name (e.g., `SignalDesk`).
4. Choose a unique username ending in `bot` (e.g., `my_signaldesk_bot`).
5. Copy the **HTTP API token** (looks like `1234567890:AAH...`).
6. Click the link to your new bot (`t.me/<your_bot_username>`) and press **Start** (or send `/start`).
   > **Important:** Telegram bots cannot message you until you press **Start** in a chat with them first.

### 5B. Get Your Numeric Chat ID (`TELEGRAM_CHAT_ID`)
- **Fastest method (recommended — avoids API rate limits):**
  1. In Telegram, search for **`@userinfobot`** and press **Start**.
  2. Copy the numeric **`Id`** it replies with (e.g., `987654321`). That is your `TELEGRAM_CHAT_ID`.
- **Alternative manual method:**
  1. Send `hello` to your new SignalDesk bot.
  2. Open `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates` in your browser and copy the numeric value inside `"chat": { "id": 987654321 }`.
  *(If Telegram returns HTTP 429 `Too Many Requests`, wait the indicated `retry_after` seconds or simply use `@userinfobot` above.)*

---

## Step 6: Configure Apps Script Properties

1. In Apps Script, open **Project Settings** (gear icon) → scroll to **Script Properties** → click **Add script property**.
2. Add the **4 required user properties** first (everything else is auto-seeded with sensible defaults when you run `setupSignalDesk()`):

| Property | Value / Default | Notes |
|---|---|---|
| `GEMINI_API_KEY` | `AIza...` | **Required.** Your Google AI Studio key. |
| `TELEGRAM_BOT_TOKEN` | `123456:AAH...` | **Required.** Token from `@BotFather`. |
| `TELEGRAM_CHAT_ID` | `987654321` | **Required.** Your private numeric chat ID. |
| `GEMINI_MODEL` | `gemini-4-hydrogen` | Optional override (auto-seeded if omitted). |

3. Click **Save script properties**.

### Complete Optional Tuning Properties (Auto-Seeded Defaults)

You can customize any of these in **Script Properties** at any time:

| Property | Default | Description |
|---|---|---|
| `SOURCE_LABEL` | `SignalDesk/Source` | Exact Gmail label to read from. |
| `TIMEZONE` | `Asia/Kolkata` | IANA timezone for scheduling and edition dates. |
| `DELIVERY_HOUR` | `7` | Morning Briefing hour (24h format; fires ~6:45–7:15 AM). |
| `DELIVERY_MINUTE` | `0` | Morning Briefing minute. |
| `ENABLE_NIGHT_RECAP` | `true` | Enables the second daily Night Recap trigger. |
| `NIGHT_DELIVERY_HOUR` | `21` | Night Recap hour (24h format; fires ~9:15–9:45 PM). |
| `NIGHT_DELIVERY_MINUTE` | `30` | Night Recap minute. |
| `EMPTY_DAY_POLICY` | `NOTIFY` | Morning behavior when 0 new emails arrive (`NOTIFY` or `SILENT`). |
| `NIGHT_EMPTY_DAY_POLICY` | `SILENT` | Night behavior when 0 new emails arrive (`SILENT` or `NOTIFY`). |
| `RETENTION_DAYS` | `7` | Automatically clears rows older than N days in `SeenEmails`, `Stories`, and `Runs`. |
| `LOOKBACK_HOURS` | `36` | Rolling Gmail lookback window (survives trigger jitter; `SeenEmails` stops duplicates). |
| `MAX_NEWSLETTERS` | `12` | Max newsletters per Gemini batch. |
| `MAX_INPUT_CHARACTERS` | `48000` | Character ceiling for the consolidated prompt. |
| `DRY_RUN_MODE` | `false` | If `true`, skips Telegram delivery and database mutation. |

> **Changing trigger times later:** After editing `DELIVERY_HOUR`, `NIGHT_DELIVERY_HOUR`, or `ENABLE_NIGHT_RECAP`, run **`setupSignalDesk()`** (or `installDailyTrigger()`) once so Apps Script updates the installed triggers.

---

## Step 7: Initialize `SignalDesk_DB` & Add Your Approved Sources

1. Open `Main.gs` in the Apps Script Editor.
2. In the top toolbar dropdown, select **`setupSignalDesk`** and click **Run**.
3. On the first run, Google will ask you to authorize permissions:
   - Click **Review permissions** → choose your Gmail account.
   - If you see *"Google hasn't verified this app"*, click **Advanced** → **Go to SignalDesk (unsafe)** → **Allow**. *(This warning always appears for personal Apps Script projects you wrote yourself.)*
4. Check the **Execution Log** at the bottom — copy the `spreadsheetUrl` for your newly created private **`SignalDesk_DB`** Google Sheet.
5. Open **`SignalDesk_DB` → `Sources` tab**:
   - Add your approved newsletter publishers and set **`enabled`** to **`TRUE`**.
   - `sender_email` supports **both** exact email addresses and `@domain` wildcards:

| source_id | publisher | sender_email | category | reliability_notes | enabled | subscribed_at |
|---|---|---|---|---|---|---|
| `src_001` | `TLDR` | `@tldrnewsletter.com` | `AI & Machine Learning` | `High-signal daily tech & AI digest` | `TRUE` | `2026-11-24` |
| `src_002` | `The Rundown AI` | `@daily.therundown.ai` | `AI & Machine Learning` | `Daily AI news briefing` | `TRUE` | `2026-11-24` |
| `src_003` | `Evolving AI Insights` | `@mail.beehiiv.com` | `AI & Machine Learning` | `Curated AI developments` | `TRUE` | `2026-11-24` |

> **Important:** Make sure every sender listed in `Sources` is **also** covered by your Gmail filter applying the `SignalDesk/Source` label!

---

## Step 8: Phased Verification Checklist

Run these functions in order from the Apps Script toolbar dropdown (`Main.gs`):

1. **`runOfflineUnitTests`** — Zero credentials needed. Confirm `12 passed, 0 failed` in Execution Logs.
2. **`testGmailConnection`** — Confirm `ok: true` and `labelFound: true`.
3. **`testMilestone1ExtractOne`** — Pulls 1 real email from `SignalDesk/Source` and prints extracted headlines, cleaned text length, article links, and candidate images.
4. **`testGeminiConnection`** — Confirms your `GEMINI_API_KEY` and `GEMINI_MODEL` return valid structured JSON.
5. **`testTelegramConnection`** — Confirms you receive a verification message in Telegram.
6. **`testMockEndToEndToTelegram`** *(Optional)* — Great if your inbox doesn't have newsletters yet! Sends a realistic formatted test briefing to Telegram using built-in mock newsletters without modifying `SignalDesk_DB`.
7. **`runDryRun`** — Processes your real Gmail newsletters end-to-end and prints the exact Telegram HTML chunks in Execution Logs without sending to Telegram or marking emails as seen.
8. **`runDailyDigest`** — Delivers your first live intelligence briefing to Telegram and records `SUCCESS` rows in `SeenEmails`, `Stories`, and `Runs`.
   - *Want to catch up on newsletters from the past 2–5 days?* Run **`runBackfillPreviousDays`** instead.
9. **`listSignalDeskTriggers`** — Confirm your automated triggers (`runMorningDigest` and `runNightRecap`) are installed without duplicates.

---

## Step 9: Newsletter Delivery Timings (IST Reference)

Most US-based daily tech & AI newsletters (like TLDR) publish on US East Coast mornings (**Mon–Fri ~4:30 PM – 8:00 PM IST**), while global and Substack digests arrive overnight.

SignalDesk's default two-shift schedule handles both smoothly:
- **Night Recap (`~9:30 PM IST`)**: Delivers US afternoon/evening newsletters the same night so you don't wait until tomorrow. Stays completely silent if nothing arrived.
- **Morning Briefing (`~7:00 AM IST`)**: Delivers overnight newsletters before a 7:30 AM wake-up.
- **7-Day Auto-Cleanup**: After every completed run, rows older than `RETENTION_DAYS` (7 days) are automatically cleared from `SeenEmails`, `Stories`, and `Runs`. Your `Sources` tab is never touched.

---

## Step 10: Troubleshooting

| Symptom / Error | Cause | Solution |
|---|---|---|
| `Gmail API Advanced Service is not enabled` | Gmail service wasn't added in Apps Script | Click **Services (`+`)** → add **Gmail API (`v1`, identifier `Gmail`)** |
| `Gmail label "SignalDesk/Source" was not found` | Label missing or typo in Gmail | Create exact label `SignalDesk/Source` or update `SOURCE_LABEL` property |
| `No enabled sources found in the Sources tab` | No rows have `enabled = TRUE` | Open `SignalDesk_DB → Sources`, add senders, set `enabled` to `TRUE` |
| Emails show `SKIPPED_EMPTY` in `SeenEmails` | Old parser or empty/non-newsletter email | Ensure you have the latest `EmailParser.gs`, delete the `SKIPPED_EMPTY` rows in `SeenEmails`, and re-run `runDailyDigest` |
| Newsletters arrive in Inbox but not in SignalDesk | Gmail filter doesn't cover that sender | Edit your Gmail filter to include the sender domain (e.g., `@daily.therundown.ai`) and apply label `SignalDesk/Source` |
| `HTTP 429` from Telegram `/getUpdates` | Too many rapid refreshes of `/getUpdates` | Wait `retry_after` seconds, or message **`@userinfobot`** in Telegram for instant numeric `TELEGRAM_CHAT_ID` |
| `chat not found` from Telegram | Bot hasn't been started by you yet | Open your bot in Telegram, press **Start** (`/start`), and re-check `TELEGRAM_CHAT_ID` |
| `HTTP 404` from Gemini API | Invalid or unsupported `GEMINI_MODEL` | Update `GEMINI_MODEL` in Script Properties (e.g., `gemini-4-hydrogen`) |
| `HTTP 429` from Gemini API | Free-tier rate limit reached | Wait 60 seconds; failed emails stay marked `FAILED` and auto-recover on the next run |
| `sendPhoto failed` in logs | Publisher blocks Telegram image hotlinking | Normal & safe — SignalDesk automatically falls back to sending the full text briefing |

---

## Publishing Your Own Copy to GitHub

1. Download the `SignalDesk` repository ZIP and extract it.
2. Never commit API keys or `.clasp.json` — all secrets remain strictly in Apps Script **Script Properties**.
3. Push directly to your GitHub repository:
   ```bash
   cd SignalDesk
   git init
   git add .
   git commit -m "Initial commit: SignalDesk daily intelligence briefing"
   git branch -M main
   git remote add origin https://github.com/<your-username>/SignalDesk.git
   git push -u origin main
   ```

# Moldable App Ideas: Consumer & Knowledge Worker Apps

> Simple, local-first apps that don't require external services or API keys.

---

## Existing Apps

For reference, these apps already exist in `~/.moldable/shared/apps/`:

| App          | Description                         | Requires External Service |
| ------------ | ----------------------------------- | ------------------------- |
| **Notes**    | Simple note-taking                  | No                        |
| **Todo**     | Task management                     | No                        |
| **Calendar** | Google Calendar integration         | Yes (Google OAuth)        |
| **Meetings** | Meeting recorder with transcription | Yes (Deepgram API)        |
| **Git Flow** | Git visualization                   | No (local git only)       |
| **Scribo**   | Language learning journal           | No                        |

---

## Priority Tier 1: Universal Appeal, Dead Simple

These apps appeal to nearly everyone and can be built in 1-2 hours.

### 1. Journal / Daily Log

**Market Size:** ~$200M (journaling apps like Day One, Journey)

A simple daily journaling app with date-based entries.

**Core Features:**

- Daily entries with rich text
- Tags and search
- Mood/weather indicators (optional)
- Calendar view of entries
- Export to Markdown

**Why it works:** Everyone reflects. No API needed—just local storage.

**Widget:** Today's entry preview, "Write" quick action button

---

### 2. Habit Tracker

**Market Size:** ~$2B (wellness/habit market growing 8% YoY)

Track daily habits with visual streaks and statistics.

**Core Features:**

- Add/remove habits
- Daily check-off grid
- Streak counters and "don't break the chain" visualization
- Weekly/monthly completion stats
- Reminders (local notifications)

**Why it works:** Behavior change is universal. Pure local storage, satisfying UX.

**Widget:** Today's habits checklist, streak count

---

### 3. Pomodoro / Focus Timer

**Market Size:** ~$500M (time management tools)

Simple focus timer with work/break intervals.

**Core Features:**

- 25/5 minute timer (customizable)
- Session count tracking
- Daily/weekly focus time stats
- Task association (what you're working on)
- Ambient sounds (optional, local files)

**Why it works:** Knowledge workers need focus. Zero dependencies.

**Widget:** Current timer, "Start Focus" button

---

### 4. Expense Tracker / Budget

**Market Size:** ~$1.2B (personal finance apps)

Log daily expenses, categorize, see where money goes.

**Core Features:**

- Quick expense entry (amount, category, note)
- Preset categories (Food, Transport, Entertainment, etc.)
- Monthly spending breakdown (pie chart)
- Daily/weekly/monthly views
- CSV export

**Why it works:** Everyone spends money. No bank API needed—manual entry is often more mindful.

**Widget:** Today's spending, monthly total vs. budget

---

### 5. Bookmark Manager / Read Later

**Market Size:** ~$500M (Pocket, Instapaper, Raindrop)

Save links, organize, and read later.

**Core Features:**

- Save URL with auto-title fetch
- Tags and folders
- Full-text search
- Archive read items
- Reading list queue

**Why it works:** Everyone saves links. Works offline once saved.

**Widget:** Reading queue count, quick add button

---

### 6. Countdown / Important Dates

**Market Size:** ~$100M (countdown apps)

Count down to important events.

**Core Features:**

- Add events with dates
- Days/hours/minutes countdown
- Categories (Personal, Work, Holiday)
- Recurring events (birthdays)
- Widget shows nearest upcoming

**Why it works:** Anticipation is universal. Trivially simple.

**Widget:** Next event countdown, list of upcoming

---

## Priority Tier 2: Knowledge Worker Essentials

These apps serve knowledge workers specifically but have broad appeal within that segment.

### 7. Flashcards / Spaced Repetition

**Market Size:** ~$500M (Anki has 10M+ users, but terrible UX)

Create decks, study with scientifically-proven spaced repetition.

**Core Features:**

- Create decks and cards (front/back)
- SM-2 spaced repetition algorithm
- Study session with difficulty rating
- Progress stats (cards due, mastered)
- Import/export (CSV, Anki format)

**Why it works:** Students, language learners, professionals. Algorithm runs locally.

**Widget:** Cards due today, "Study Now" button

---

### 8. Personal CRM / Contacts+

**Market Size:** ~$500M (personal CRM niche, Monica HQ, Clay)

Enhanced contacts with relationship context.

**Core Features:**

- Contact entries (name, email, phone, company)
- Relationship notes ("Met at conference, interested in AI")
- Last contact date tracking
- Birthday/anniversary reminders
- Tags (Friend, Colleague, Family, Lead)

**Why it works:** Networking is essential. No API—just structured local data.

**Widget:** Birthdays this week, contacts to follow up

---

### 9. Clipboard History

**Market Size:** ~$200M (clipboard managers like Alfred, Paste)

Never lose copied text again.

**Core Features:**

- Auto-capture clipboard history
- Search history
- Pin frequently used items
- Categories (Text, Links, Images)
- Keyboard shortcuts for quick paste

**Why it works:** Power users copy/paste constantly. System-level but simple.

**Widget:** Recent clips, search button

---

### 10. Quick Notes / Scratchpad

**Market Size:** Part of ~$2B note-taking market

Instant capture for fleeting thoughts (like Apple Notes scratch space).

**Core Features:**

- Global hotkey to capture
- Auto-dated entries
- Search
- Move to main Notes app when ready
- Plain text, fast

**Why it works:** Capture friction kills ideas. Lighter than full Notes app.

**Widget:** Quick capture input, recent scratches

---

### 11. Daily Planner / Time Blocking

**Market Size:** ~$300M (planning apps like Structured, Sunsama)

Plan your day hour by hour.

**Core Features:**

- Day view with time slots
- Drag tasks into slots
- Integration with local Todo app
- Daily review/reflection prompt
- Templates for recurring days

**Why it works:** Intentional time use. Pure local, no calendar sync needed.

**Widget:** Today's schedule overview

---

### 12. Writing / Markdown Editor

**Market Size:** ~$500M (iA Writer, Ulysses, Bear)

Distraction-free writing environment.

**Core Features:**

- Clean markdown editor
- Focus mode (current paragraph highlight)
- Word/character count
- Folder organization
- Export to PDF, HTML, DOCX

**Why it works:** Writers need focus. Markdown is local text files.

**Widget:** Current document, word count

---

## Priority Tier 3: Lifestyle & Wellness

These serve specific but large lifestyle segments.

### 13. Workout / Gym Log

**Market Size:** ~$1B (fitness tracking, Strong, JEFIT)

Log exercises, track progressive overload.

**Core Features:**

- Exercise library (local database)
- Log sets, reps, weight
- Workout templates
- Progress charts (1RM estimates, volume)
- Personal records tracking

**Why it works:** Gym-goers need tracking. No wearable sync needed.

**Widget:** Today's workout, recent PRs

---

### 14. Recipe Box

**Market Size:** ~$500M (recipe apps like Paprika, Mela)

Store and organize personal recipes.

**Core Features:**

- Add recipes (ingredients, steps, photos)
- Categories and tags
- Search by ingredient
- Meal planning calendar
- Shopping list generation
- Scale servings

**Why it works:** Home cooks save recipes everywhere. One local home.

**Widget:** Random recipe suggestion, meal plan today

---

### 15. Book Tracker / Reading Log

**Market Size:** ~$300M (Goodreads has 125M users, terrible UX)

Track what you read, want to read, and your thoughts.

**Core Features:**

- Add books (title, author, cover image)
- Status: Want to Read, Reading, Finished
- Star rating and notes
- Reading progress (page/percentage)
- Yearly reading goal

**Why it works:** Readers track obsessively. Pure local data.

**Widget:** Currently reading, progress bar

---

### 16. Meditation Timer

**Market Size:** ~$500M (meditation timer niche within $2B meditation market)

Simple meditation timer without the subscription baggage.

**Core Features:**

- Timer with interval bells
- Session history and streaks
- Guided breathing (simple animations)
- Statistics (total time, consistency)
- Ambient sounds (local files)

**Why it works:** Meditation is mainstream. Headspace/Calm are overpriced for timer.

**Widget:** Today's meditation, streak count

---

### 17. Mood Tracker

**Market Size:** ~$200M (mental wellness tracking)

Log mood and identify patterns.

**Core Features:**

- Quick mood entry (1-5 or emoji scale)
- Optional notes
- Factor tracking (sleep, exercise, weather)
- Trend visualization
- Correlations ("You're happier when you exercise")

**Why it works:** Mental health awareness growing. Private local data.

**Widget:** Mood today prompt, weekly trend

---

### 18. Sleep Log

**Market Size:** ~$300M (sleep tracking without wearables)

Manual sleep tracking for those without smartwatches.

**Core Features:**

- Log bedtime/wake time
- Sleep quality rating
- Notes (dreams, disturbances)
- Sleep debt calculation
- Weekly/monthly stats

**Why it works:** Sleep is health. Manual is fine—most people know when they slept.

**Widget:** Last night's sleep, average this week

---

### 19. Plant Care / Garden Tracker

**Market Size:** ~$100M (plant care apps, part of $8B houseplant market)

Track plants, watering schedules, and care notes.

**Core Features:**

- Plant entries with photos
- Watering schedule and reminders
- Care notes (repotted, fertilized, etc.)
- Light/water requirements reference
- Growth photo timeline

**Why it works:** Plant parents are passionate. Simple CRUD app.

**Widget:** Plants to water today

---

### 20. Home Inventory

**Market Size:** ~$100M (inventory/insurance tracking)

Catalog belongings for insurance or organization.

**Core Features:**

- Items with photos, serial numbers, purchase date
- Categories (Electronics, Furniture, etc.)
- Location tracking (which room)
- Purchase price and current value
- Export for insurance claims

**Why it works:** Useful for renters/homeowners. Peace of mind.

**Widget:** Total inventory value, recently added

---

## Priority Tier 4: Niche but Passionate Users

These serve smaller but highly engaged user segments.

### 21. Wine/Beer/Coffee Log

**Market Size:** ~$100M (Vivino, Untappd for the niche)

Track beverages you've tried and loved.

**Core Features:**

- Log entry (name, type, origin, rating)
- Tasting notes
- Photo capture
- Favorites and wish list
- Statistics (varieties tried, preferences)

**Why it works:** Hobbyist enthusiasts log obsessively.

**Widget:** Recent favorites, recommendations

---

### 22. Project Ideas / Someday List

**Market Size:** Part of productivity tools

Capture project ideas that aren't actionable yet.

**Core Features:**

- Idea entries with description
- Priority/excitement rating
- Resource links
- Move to active projects
- Review reminders

**Why it works:** Creatives have endless ideas. GTD "someday/maybe" list.

**Widget:** Random idea to inspire, total ideas count

---

### 23. Gratitude Journal

**Market Size:** ~$100M (gratitude specific apps)

Daily gratitude practice.

**Core Features:**

- Daily 3 things prompt
- Photo attachment
- Streak tracking
- Random past gratitude review
- Export/share

**Why it works:** Proven mental health benefits. Simple daily ritual.

**Widget:** Today's gratitude prompt, streak

---

### 24. Keyboard Shortcut Reference

**Market Size:** Niche (developers, power users)

Personal cheatsheet for keyboard shortcuts.

**Core Features:**

- Organize by app
- Search shortcuts
- Mark favorites
- Custom shortcuts
- Quick reference overlay

**Why it works:** Power users constantly look up shortcuts.

**Widget:** App shortcuts quick view

---

### 25. Quote Collection

**Market Size:** ~$50M (quote apps)

Save and revisit meaningful quotes.

**Core Features:**

- Add quotes with source
- Tags and categories
- Random quote of the day
- Search
- Share as image

**Why it works:** Everyone saves quotes somewhere. Give them a home.

**Widget:** Quote of the day

---

## Implementation Priority Matrix

| App              | Simplicity (1-5) | Market Size | Build Time | Priority Score |
| ---------------- | ---------------- | ----------- | ---------- | -------------- |
| Journal          | 5                | $200M       | 2h         | ⭐⭐⭐⭐⭐     |
| Habit Tracker    | 5                | $2B         | 2h         | ⭐⭐⭐⭐⭐     |
| Pomodoro Timer   | 5                | $500M       | 1h         | ⭐⭐⭐⭐⭐     |
| Expense Tracker  | 4                | $1.2B       | 3h         | ⭐⭐⭐⭐⭐     |
| Bookmark Manager | 4                | $500M       | 3h         | ⭐⭐⭐⭐       |
| Countdown Timer  | 5                | $100M       | 1h         | ⭐⭐⭐⭐       |
| Flashcards       | 3                | $500M       | 4h         | ⭐⭐⭐⭐       |
| Personal CRM     | 3                | $500M       | 4h         | ⭐⭐⭐⭐       |
| Quick Notes      | 5                | $2B\*       | 1h         | ⭐⭐⭐⭐       |
| Daily Planner    | 4                | $300M       | 3h         | ⭐⭐⭐⭐       |
| Writing Editor   | 3                | $500M       | 5h         | ⭐⭐⭐         |
| Workout Log      | 3                | $1B         | 4h         | ⭐⭐⭐         |
| Recipe Box       | 3                | $500M       | 4h         | ⭐⭐⭐         |
| Book Tracker     | 4                | $300M       | 2h         | ⭐⭐⭐         |
| Meditation Timer | 5                | $500M       | 1h         | ⭐⭐⭐         |
| Mood Tracker     | 5                | $200M       | 2h         | ⭐⭐⭐         |

---

## Recommended First Wave (Ship in v1)

Based on simplicity, market size, and complementing existing Notes/Todo apps:

1. **Habit Tracker** — Daily engagement, high retention, everyone has habits
2. **Journal** — Personal reflection, pairs with Notes for daily capture
3. **Pomodoro Timer** — Utility for knowledge workers, quick win
4. **Expense Tracker** — Universal need, demonstrates data visualization
5. **Flashcards** — Learning use case, spaced repetition is unique value

These five apps, combined with existing Notes and Todo, create a complete "personal productivity suite" that requires zero external services.

---

## App Synergies

When built together, these apps can share data:

- **Habit + Journal**: "Journaling" as a habit, auto-log when journal written
- **Pomodoro + Todo**: Associate focus sessions with tasks
- **Expense + Habit**: Track "no-spend days" as a habit
- **Mood + Journal**: Correlate mood with journal sentiment
- **Flashcards + Notes**: Create flashcards from highlighted notes

This interconnected personal data layer is Moldable's unique advantage over siloed apps.

---

## Notes on Market Size Estimates

Market sizes are rough estimates based on:

- App store revenue for category leaders
- Venture funding in segments
- User base × estimated ARPU

The local-first angle doesn't capture the full market (many users prefer cloud sync), but the privacy-conscious and power-user segments are substantial and underserved.

---

---

## Additions: High-Revenue Apps We Were Missing

Based on App Store/Play Store download and revenue data for 2025, these categories are **top performers** that weren't in the original list:

### 26. Document Scanner with OCR

**Market Size:** ~$2B+ (document management, top paid app category)

Turn phone camera into a document scanner with text recognition.

**Core Features:**

- Camera capture with edge detection
- Auto-perspective correction
- OCR text extraction (runs locally)
- Multi-page PDF export
- Folder organization

**Why it's huge:** Genius Scan, CamScanner, Adobe Scan are consistently top-grossing. Privacy-conscious users want local OCR without uploading to servers.

**Widget:** Quick scan button, recent scans

---

### 27. White Noise / Sleep Sounds

**Market Size:** ~$1.2B (growing to $2.5B by 2032)

Ambient sounds for sleep, focus, and relaxation.

**Core Features:**

- Sound library (rain, ocean, forest, fan, etc.)
- Mix multiple sounds with volume control
- Sleep timer (fade out)
- Favorites
- Optional: record your own ambient sounds

**Why it's huge:** BetterSleep makes ~$600K/month. Sleep Cycle, ShutEye each ~$15M/year. All work with local audio files.

**Widget:** Quick play favorite mix, sleep timer

---

### 28. Advanced Calculator

**Market Size:** ~$300M (calculator apps)

Beyond basic math: scientific, financial, and graphing modes.

**Core Features:**

- Scientific functions (trig, log, etc.)
- Financial calculations (loan, mortgage, tip)
- Unit-aware calculations
- History tape
- Optional: graphing mode

**Why it's huge:** Calc Pro, PCalc are perennial top paid apps. Power users want more than the built-in calculator.

**Widget:** Quick calculation input

---

### 29. Unit Converter

**Market Size:** ~$100M (utility apps)

Convert between any units instantly.

**Core Features:**

- Categories: Length, Weight, Temperature, Volume, Time, etc.
- Favorites for frequently used conversions
- Calculator integration
- Copy result to clipboard

**Why it's huge:** Simple, universal need. "Convert Any Unit" is consistently top paid.

**Widget:** Quick converter for favorite category

---

### 30. Voice Recorder / Voice Memos

**Market Size:** ~$200M (audio recording)

Simple audio recording for meetings, lectures, ideas.

**Core Features:**

- One-tap recording
- Pause/resume
- Trim and edit
- Folder organization
- Playback speed control

**Why it's huge:** Built-in voice memos apps are limited. Users want better organization and editing.

**Widget:** Record button, recent recordings

---

### 31. Multi-Timer / Stopwatch

**Market Size:** ~$100M (timer utilities)

Multiple simultaneous timers for cooking, workouts, etc.

**Core Features:**

- Multiple named timers running simultaneously
- Presets (3 min eggs, 25 min pomodoro, etc.)
- Stopwatch with laps
- Alarm sounds
- Kitchen-friendly large display mode

**Why it's huge:** Cooking, fitness, productivity all need multi-timers. Built-in timers only do one at a time.

**Widget:** Active timers, quick start preset

---

### 32. Shift Work Calendar

**Market Size:** ~$500M (work scheduling)

Track variable work schedules and estimate income.

**Core Features:**

- Visual calendar with shift blocks
- Drag-and-drop shift assignment
- Multiple shift types (Morning, Night, etc.)
- Hourly rate configuration
- Monthly income estimation

**Why it's huge:** HotSchedules was #1 paid iPhone app in 2025. Millions of hourly workers need this.

**Widget:** Next shift, this week's hours

---

### 33. Subscription Manager

**Market Size:** ~$200M (personal finance adjacent)

Track all your subscriptions and renewal dates.

**Core Features:**

- List services with cost and billing cycle
- Monthly/yearly total spend calculation
- Renewal date reminders
- Cancel by date tracking
- Categories (Streaming, Software, etc.)

**Why it's huge:** "Subscription fatigue" is real. Average person has 12+ subscriptions and forgets half.

**Widget:** Total monthly spend, upcoming renewals

---

### 34. Code Snippets / Text Expander

**Market Size:** ~$100M (developer tools)

Save and quickly access reusable text and code.

**Core Features:**

- Syntax-highlighted code storage
- Quick copy to clipboard
- Tags and search
- Variables/placeholders (optional)
- Import/export

**Why it works:** Developers, support staff, writers all reuse text constantly.

**Widget:** Favorite snippets, quick copy

---

### 35. PDF Toolkit

**Market Size:** ~$300M (document tools)

Local PDF manipulation without uploading to sketchy websites.

**Core Features:**

- Merge multiple PDFs
- Split pages
- Rotate pages
- Simple annotations (highlight, text)
- Compress file size

**Why it's huge:** Everyone needs PDF tools. Privacy-conscious users won't upload sensitive docs to "free online PDF merger."

**Widget:** Quick merge, recent files

---

### 36. Personal Wiki / Knowledge Base

**Market Size:** ~$200M (note-taking power users)

Interconnected notes with backlinks.

**Core Features:**

- Pages with [[wiki links]]
- Backlinks panel
- Tags
- Graph view (optional)
- Full-text search

**Why it works:** Obsidian, Notion, Roam proved the market. Simpler local version has appeal.

**Widget:** Recently edited pages, quick capture

---

### 37. Secure Vault / Secret Notes

**Market Size:** ~$150M (security utilities)

Store sensitive info locally with encryption.

**Core Features:**

- AES-256 encrypted storage
- Master password unlock
- Store: WiFi passwords, lock combinations, API keys, secure notes
- Copy to clipboard
- Auto-lock timeout

**Why it works:** Not everyone wants a full password manager. Many just need secure storage for misc secrets.

**Widget:** Quick unlock, recently accessed

---

### 38. Infinite Whiteboard

**Market Size:** ~$100M+ (visual thinking tools, growing fast)

Unlimited canvas for visual brainstorming.

**Core Features:**

- Infinite pan/zoom canvas
- Sticky notes
- Freehand drawing
- Shapes and connection lines
- Export to image/PDF

**Why it's huge:** Top category on iPad. FigJam, Miro, Excalidraw proved the market. Local version is valuable.

**Widget:** Recent boards, quick capture

---

## Updated Priority Matrix

| App                  | Simplicity | Market Size | Revenue Potential    | Priority   |
| -------------------- | ---------- | ----------- | -------------------- | ---------- |
| Document Scanner     | 3          | $2B+        | High (top paid)      | ⭐⭐⭐⭐⭐ |
| White Noise/Sleep    | 4          | $1.2B       | High ($600K/mo apps) | ⭐⭐⭐⭐⭐ |
| Shift Work Calendar  | 3          | $500M       | High (#1 paid app)   | ⭐⭐⭐⭐⭐ |
| Subscription Manager | 5          | $200M       | Medium               | ⭐⭐⭐⭐   |
| Multi-Timer          | 5          | $100M       | Medium               | ⭐⭐⭐⭐   |
| Advanced Calculator  | 3          | $300M       | Medium               | ⭐⭐⭐     |
| Unit Converter       | 5          | $100M       | Low                  | ⭐⭐⭐     |
| Voice Recorder       | 4          | $200M       | Medium               | ⭐⭐⭐     |
| PDF Toolkit          | 2          | $300M       | High                 | ⭐⭐⭐     |
| Secure Vault         | 3          | $150M       | Medium               | ⭐⭐⭐     |
| Personal Wiki        | 2          | $200M       | Medium               | ⭐⭐       |
| Infinite Whiteboard  | 1          | $100M+      | Medium               | ⭐⭐       |
| Code Snippets        | 4          | $100M       | Low (niche)          | ⭐⭐       |

---

## Revised First Wave Recommendation

Based on revenue data, the **highest-impact additions** to Notes/Todo are:

1. **Habit Tracker** — Universal, high retention
2. **Journal** — Pairs with Notes
3. **Document Scanner** — Top paid category, privacy differentiator
4. **White Noise / Sleep Sounds** — Proven $600K/month potential
5. **Shift Work Calendar** — Was literally #1 paid iPhone app
6. **Expense Tracker** — Universal need
7. **Subscription Manager** — Timely, low complexity

These seven apps, plus existing Notes/Todo, cover the most lucrative local-first opportunities.

---

## What NOT to Build (Requires External Services)

For reference, these categories need APIs or external services:

- **Weather widgets** — Need weather API
- **Stock/crypto trackers** — Need market data API
- **Email clients** — Need IMAP/OAuth
- **Social media dashboards** — Need platform APIs
- **News readers** — Need RSS or news APIs
- **AI writing assistants** — Need LLM APIs
- **Translation tools** — Need translation API
- **Voice transcription** — Need speech-to-text API (like Meetings app)
- **Calendar sync** — Need calendar provider OAuth (like Calendar app)

---

# Codex App Ideas (Local-Only, Broad Appeal)

Goal: prioritize simple, local-first apps that do not require external services
or API keys, and that appeal to a wide range of consumers and knowledge workers.
Market size is a rough, global estimate of potential users who might benefit
from the app class (order of magnitude, not TAM dollars).

## Prioritized List

1. Notes (Quick Capture + Search)
   - Why: universal need; minimal setup; immediate value
   - Core: rich text/markdown, tags, quick add, full-text search
   - Market size: 1B+ (any knowledge worker + many consumers)

2. To-Do / Tasks (Personal + Work)
   - Why: daily habit; simple data model; high retention
   - Core: lists, due dates, reminders, recurring tasks
   - Market size: 800M+

3. Daily Journal (Prompted + Freeform)
   - Why: habit-building; mental clarity; simple UI
   - Core: daily entry, mood, prompts, streaks
   - Market size: 300M+

4. Meeting Notes (Local, Structured)
   - Why: common workflow; no external integrations needed
   - Core: agenda, notes, action items, decisions
   - Market size: 500M+

5. Personal Knowledge Base (Lightweight Wiki)
   - Why: captures long-term knowledge; simple linking
   - Core: pages, backlinks, tags, graph view (optional)
   - Market size: 200M+

6. Reading List / Bookmarks (Local)
   - Why: common pain point; simple storage + tagging
   - Core: add items, tags, status (to read/reading/done)
   - Market size: 400M+

7. Habit Tracker (Simple)
   - Why: broad consumer appeal; recurring data
   - Core: daily check-ins, streaks, reminders
   - Market size: 300M+

8. Personal Finance Tracker (Manual)
   - Why: no bank APIs needed; useful for budgeting
   - Core: income/expense entries, categories, monthly summary
   - Market size: 200M+

9. Time Tracker (Manual Focus Sessions)
   - Why: work productivity; no external services needed
   - Core: timers, projects, weekly summary
   - Market size: 150M+

10. Simple CRM / Contacts with Notes
    - Why: freelancers, sales, personal networks
    - Core: contacts, interaction notes, reminders
    - Market size: 100M+

11. Idea Backlog / Brain Dump
    - Why: low friction; appeals to creators
    - Core: capture, tags, triage pipeline
    - Market size: 200M+

12. Study Cards (Local Flashcards)
    - Why: students + lifelong learners
    - Core: decks, spaced review, stats
    - Market size: 200M+

## Common Requirements (Local-Only)

- Local storage (SQLite) with export/import
- Full-text search
- Fast capture flow (keyboard-first)
- Simple tagging and filtering
- Optional sync can be added later (out of scope)

## Notes

- All ideas avoid external APIs by default.
- Each idea maps cleanly to widget view (glanceable) and full view.

---

# Gemini App Ideas (Simple, Local, Broad Appeal)

Goal: A prioritized list of app ideas that are simple to build, require no external APIs/services (local-first), and appeal to a massive audience of consumers and knowledge workers.

Market size estimates are rough global potential user bases (order of magnitude).

## High Priority (Mass Appeal)

1.  **Daily Journal / Diary**
    - **Why:** Mental health, memory keeping, gratitude practice. High retention potential.
    - **Core:** Date-based text entry, mood selector (emoji), "On this day" flashback, fast search.
    - **Market Size:** 300M+
    - **Complexity:** Low. Text + Date index.

2.  **Habit Tracker**
    - **Why:** Self-improvement is universal. Visualizing progress ("streaks") is addictive.
    - **Core:** List of habits, daily checkbox grid, streak counter, simple graphs.
    - **Market Size:** 300M+
    - **Complexity:** Low. Boolean matrix.

3.  **Shift Work Calendar / Income Estimator** (New)
    - **Why:** Millions of service/hourly workers need to track variable schedules and estimate pay. Highly paid category on mobile.
    - **Core:** Visual calendar to drag-and-drop shifts (e.g., "Morning", "Night"), set hourly rates, calculate estimated monthly wage.
    - **Market Size:** 500M+
    - **Complexity:** Medium. Date logic + math.

4.  **Subscription Manager** (New)
    - **Why:** "Subscription fatigue" is real. Users forget renewal dates.
    - **Core:** List of services, cost, billing cycle (monthly/yearly), renewal alerts, total monthly spend calculation.
    - **Market Size:** 200M+
    - **Complexity:** Low.

5.  **Personal Recipe Book**
    - **Why:** Everyone eats. Online recipe sites are cluttered with ads/stories. Local copy is superior.
    - **Core:** Title, ingredients list, instructions, photo upload, tags (e.g., "Dinner", "Quick").
    - **Market Size:** 400M+
    - **Complexity:** Low/Medium. Structured text + images.

6.  **Manual Expense / Budget Tracker**
    - **Why:** Privacy-conscious finance. No bank linking needed. "Envelope" method.
    - **Core:** Log transaction (Amount, Category, Date, Note), monthly limits vs actuals.
    - **Market Size:** 200M+
    - **Complexity:** Medium. Data entry + aggregation charts.

## Knowledge Worker / Productivity

7.  **Flashcards (Spaced Repetition)**
    - **Why:** Students, language learners, certifications. Proven utility.
    - **Core:** Decks, Front/Back card creation, simple "Rate difficulty" review loop.
    - **Market Size:** 200M+
    - **Complexity:** Medium. Scheduling algorithm (Leitner system).

8.  **Code Snippets / Text Expander**
    - **Why:** Developers and support staff reuse text constantly.
    - **Core:** Title, syntax highlighting, copy button, tags.
    - **Market Size:** 100M+
    - **Complexity:** Low.

9.  **Read Later / Bookmarks Manager**
    - **Why:** Browser bookmarks are messy. People want a clean "inbox" for reading.
    - **Core:** Paste URL, add title/notes, mark as Read/Unread, archive.
    - **Market Size:** 200M+
    - **Complexity:** Low.

10. **Infinite Whiteboard** (New)
    - **Why:** Visual thinkers need unstructured space. Top category on iPad/Tablets, growing on Desktop.
    - **Core:** SVG canvas, sticky notes, freehand drawing (optional), connection lines, infinite pan/zoom.
    - **Market Size:** 100M+
    - **Complexity:** High (Canvas interaction).

11. **PDF Toolkit** (New)
    - **Why:** Privacy-first PDF manipulation. Uploading sensitive docs to "free online PDF mergers" is risky.
    - **Core:** Merge multiple PDFs, split pages, rotate, simple text annotation.
    - **Market Size:** 300M+ (Office workers).
    - **Complexity:** Medium/High (PDF library usage).

## Lifestyle & Utility

12. **Workout Log**
    - **Why:** Fitness tracking is huge. Simple log is better than complex app for many.
    - **Core:** Exercises, Sets, Reps, Weight, Rest timer, history graph per exercise.
    - **Market Size:** 200M+
    - **Complexity:** Medium. Relational data (Workout -> Exercises -> Sets).

13. **Home Inventory / Asset Tracker**
    - **Why:** Insurance purposes, organizing collections, warranty tracking.
    - **Core:** Item name, location (Room), purchase date, price, photo, warranty expiry.
    - **Market Size:** 100M+
    - **Complexity:** Medium. Database fields + photos.

14. **Countdown / Event Tracker**
    - **Why:** Anxiety relief, excitement building. "Days until vacation", "Days since incident".
    - **Core:** Event name, date, count up/down display, recurring annual events.
    - **Market Size:** 100M+
    - **Complexity:** Low. Date math.

15. **Secure Vault / Secret Notes** (New)
    - **Why:** Users need to store WiFi codes, lock combos, and API keys securely but don't want full password managers.
    - **Core:** AES-encrypted text storage, master password unlock (local only), copy-to-clipboard.
    - **Market Size:** 150M+
    - **Complexity:** Medium (Crypto implementation).

## Technical Implementation Notes

- **Storage:** All apps should use SQLite (via `better-sqlite3` or Prisma) or simple JSON files if very small.
- **UI:** Use standard `shadcn/ui` components.
- **Widget View:** Critical for all.
  - _Habit Tracker:_ Show today's grid.
  - _Journal:_ "Write today's entry" prompt.
  - _Shift Work:_ Next shift details.
  - _Subscription:_ "Upcoming renewals this week".
- **No API Keys:** None of these require external keys, making them "install and run" immediately.

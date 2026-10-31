# Kairos - AI-native project management that forecasts, not just tracks

**Kairos** is a full-stack, AI-native project management system: real-time Kanban, list and Gantt
views on top of a relational database, a planning engine that answers the question every manager
actually asks - *"will we make it?"* - and a Claude Opus 5.5 copilot that can read the project and
act on it in plain language.

![Board](docs/screenshots/1-board.png)

## Highlights

### AI-native (Claude Opus 5.5)

- **Project copilot agent** - a chat panel backed by a tool-using Claude agent with 8 tools
  (`project_overview`, `list_tasks`, `get_task`, `create_task`, `update_task`, `add_dependency`,
  `add_comment`, `get_analytics`). Ask *"who is overloaded? rebalance the work"* or *"create a launch
  checklist and link it in order"* and it reads live data, makes the changes and lists every action.
  Tools call the same API layer as the UI, **as the signed-in user**, so permissions, validation, the
  audit trail and real-time sync all apply (a viewer's copilot cannot write).
- **Break down with AI** - turns a large task into 3-8 estimated subtasks with finish-to-start
  dependencies (structured JSON output); you edit or untick them, then create them in one click.
- **Natural-language capture** - type *"Dor should fix the flaky checkout test by Thursday, urgent, ~2 pts"*
  and the new-task form fills itself (assignee, due date, priority, estimate, labels).
- **AI status report** - a stakeholder-ready sprint report written from the live burndown, Monte Carlo
  forecast, risk radar, workload and activity feed.
- **Plan my day** - a personal home page across every project: Claude orders today's work from your
  open tasks, deadlines, blockers and unread inbox, gives the reason for each pick and flags what to chase.
- **AI triage** - type a title and Claude suggests priority, estimate and labels calibrated against the
  project, proposes the best owner from who has done similar work and who has spare capacity, and
  warns about likely duplicates before you create them.
- **Ask from anywhere** - the Ctrl/⌘ K command bar searches every task you can see, jumps to any project
  or view, and hands a full sentence straight to the copilot.
- Uses `claude-opus-5-5` with adaptive thinking and server-side refusal fallbacks; every other feature
  works without an API key.

### Planning & collaboration

- **Five synchronized views** - drag-and-drop Kanban with WIP limits, sortable list, Gantt timeline
  with dependency arrows, sprint planning, and an insights dashboard.
- **Real-time collaboration** - every change is pushed over WebSockets to everyone viewing the project.
- **Critical-path scheduling** - dependencies form a DAG (cycles are rejected); Kairos runs the
  Critical Path Method, highlights the zero-slack chain and auto-schedules undated work.
- **Monte Carlo forecasting** - resamples the team's real daily throughput 5,000 times to give the
  probability of finishing the sprint on time and P50/P85/P95 delivery dates.
- **Risk radar** - overdue, blocked-while-in-progress, WIP breaches, unestimated sprint work and
  over-capacity people, each with a suggested action (e.g. *"Hand PLS-11 (3 pts) to May, who has 7 pts spare"*).
- **Inbox and @mentions** - assignments, `@name` mentions in comments and descriptions, comments and
  status changes on your work land in a personal inbox, pushed live over a per-user WebSocket.
- **Keyboard first and accessible** - command bar, `C` new task, `A` copilot, keyboard-operable cards and
  rows, visible focus, labelled controls, confirm dialogs for destructive actions, reduced-motion support.
- **Full audit trail** - field-level activity log (who changed what, from what, to what), comments.
- **Multi-tenant with roles** - workspaces, owner/admin/member/viewer permissions, JWT auth.

| Sprint planning & forecast | Insights & risk radar |
|---|---|
| ![Sprint](docs/screenshots/4-sprint.png) | ![Insights](docs/screenshots/5-insights.png) |
| **Gantt timeline + critical path** | **Task details, dependencies, comments** |
| ![Timeline](docs/screenshots/3-timeline.png) | ![Drawer](docs/screenshots/6-task-drawer.png) |
| **AI copilot** | **AI task capture** |
| ![Copilot](docs/screenshots/7-copilot.png) | ![AI capture](docs/screenshots/8-ai-capture.png) |
| **My day: AI plan, my tasks, inbox** | **Command bar: search or ask the AI** |
| ![My day](docs/screenshots/10-my-day.png) | ![Command bar](docs/screenshots/12-palette-ask.png) |

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript, Vite, hand-written SVG charts (no chart library), native HTML5 drag-and-drop |
| Backend | FastAPI, Pydantic v2, SQLAlchemy 2, WebSockets, JWT + bcrypt |
| AI | Anthropic Python SDK, Claude Opus 5.5, tool-use agent loop, structured outputs, refusal fallbacks |
| Database | PostgreSQL 16 (SQLite for zero-setup development and tests) |
| Quality | 36 pytest tests (incl. the agent loop with a scripted fake Claude client) on SQLite and PostgreSQL, GitHub Actions CI |
| Deploy | Multi-stage Dockerfile (one image serves API + SPA), docker-compose with Postgres |

## Run it

**Docker (recommended)** - starts Postgres, seeds a demo workspace and serves everything on port 8000:

```bash
export ANTHROPIC_API_KEY=sk-ant-...   # optional: enables the AI features
docker compose up --build
# open http://localhost:8000 and click "Try the demo workspace"
```

**Local development**

```bash
# API
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
python -m app.seed                 # demo data (SQLite file kairos.db)
uvicorn app.main:app --reload      # http://localhost:8000/docs for the OpenAPI UI

# Web (second terminal)
cd frontend
npm install
npm run dev                        # http://localhost:5173 (proxies /api and /ws to :8000)
```

Demo login: `demo@kairos.dev` / `demo1234` (also `dor@`, `noa@`, `amit@kairos.dev` - open two
browsers to watch real-time sync).

**Tests**

```bash
cd backend && pytest -q
TEST_DATABASE_URL=postgresql+psycopg://user:pass@localhost/kairos_test pytest -q   # against Postgres
```

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `DATABASE_URL` | `sqlite:///./kairos.db` | SQLAlchemy URL, e.g. `postgresql+psycopg://...` |
| `KAIROS_SECRET` | dev value | JWT signing key - **set a long random value in production** |
| `KAIROS_TOKEN_HOURS` | `72` | Token lifetime |
| `KAIROS_WEEKEND` | `5,6` | Non-working weekdays (Mon=0). Use `4,5` for a Fri/Sat weekend |
| `KAIROS_CORS` | `http://localhost:5173` | Allowed origins for the dev server |
| `ANTHROPIC_API_KEY` | unset | Enables the AI features (copilot, breakdown, capture, reports) |
| `KAIROS_AI_MODEL` | `claude-opus-5-5` | Claude model used by the AI features |

## Project structure

```
backend/app/
  models.py          13-table relational schema
  routers/           auth, workspaces, projects, tasks, sprints, analytics, ai, me (inbox, my work, search)
  services/          ordering (fractional ranks), activity log, notify (inbox + @mentions), scheduling (CPM), forecast (Monte Carlo)
  ai/                client (Claude SDK wrapper), tools (agent toolbox), copilot (agent loop + AI features)
  realtime.py        WebSocket fan-out per project and per user
  seed.py            realistic demo workspace
frontend/src/
  store.tsx          project state + real-time sync
  views/             MyDay, Board, ListView, Timeline, SprintView, Insights
  components/        CommandPalette, Copilot, TaskCard, TaskDrawer, NewTask, Confirm, Charts
docs/                architecture notes, screenshots
```

## Design decisions

* **States carry a semantic group** (backlog, unstarted, started, completed, cancelled), so teams can
  rename columns freely while analytics stays correct.
* **Per-project task keys** (`KAI-42`) from a project counter with a unique constraint.
* **Float ranks for drag-and-drop**: a move writes one row; columns are renumbered automatically when
  the gap between neighbours collapses.
* **Field-level activity log** powering the audit trail, burndown and throughput history.
* **Dependencies with cycle detection on insert**, feeding critical-path scheduling, Monte Carlo
  forecasting and the risk radar, with the AI copilot on top.

See [docs/architecture.md](docs/architecture.md).

## License

MIT

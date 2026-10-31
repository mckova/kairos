# Kairos

Project management that tells you when the work will land. Kanban, list, Gantt and sprint views on a
relational database, a planning engine that simulates delivery dates from the work a team actually
finished, and a Claude Opus 5.5 assistant that reads the project and changes it on request.

![Board](docs/screenshots/1-board.png)

## What it does

### Claude inside the workflow

- **Project assistant.** A chat panel backed by a tool-using Claude agent with 8 tools
  (`project_overview`, `list_tasks`, `get_task`, `create_task`, `update_task`, `add_dependency`,
  `add_comment`, `get_analytics`). Ask *"who is overloaded? rebalance the work"* or *"create a launch
  checklist and link it in order"*; it reads live data, makes the changes and lists every action.
  Tools call the same API layer as the UI **as the signed-in user**, so permissions, validation, the
  audit trail and real-time sync all apply. A viewer's assistant cannot write.
- **Split into subtasks.** Turns a large task into 3 to 8 estimated subtasks with finish-to-start
  dependencies (structured JSON output). You edit or untick them, then create them in one click.
- **Sentence capture.** Type *"Dor should fix the flaky checkout test by Thursday, urgent, about 2 points"*
  and the new-task form fills in assignee, due date, priority, estimate and labels.
- **Triage.** From a title, Claude suggests priority, estimate and labels calibrated against the
  project, proposes an owner from who has done similar work and has spare capacity, and warns about
  likely duplicates before you create one.
- **Status report.** A sprint report for stakeholders, written from the live burndown, forecast,
  risks, workload and activity feed.
- **Plan my day.** A personal page across every project. Claude orders today's work from open tasks,
  deadlines, blockers and the unread inbox, and gives the reason for each pick.
- **Find or ask.** `Ctrl K` / `⌘ K` searches every task you can see, jumps to any project or view, and
  hands a full question to the assistant.
- Uses `claude-opus-5-5` with adaptive thinking and server-side fallbacks. Everything else works
  without an API key.

### Planning and collaboration

- **Five views of one project.** Drag-and-drop board with WIP limits, sortable list, Gantt timeline
  with dependency arrows, sprint planning, and insights.
- **Real-time.** Every change is pushed over WebSockets to everyone viewing the project.
- **Critical path.** Dependencies form a DAG (cycles are rejected). Kairos runs the Critical Path
  Method, highlights the zero-slack chain and schedules undated work.
- **Monte Carlo forecast.** Resamples the team's daily throughput 5,000 times to give the chance of
  finishing the sprint on time and 50/85/95% delivery dates.
- **Risks.** Overdue work, tasks in progress while blocked, WIP breaches, unestimated sprint work and
  people over capacity, each with a suggested action (*"Hand PLS-11 (3 pts) to May Cohen, who has 7 pts spare"*).
- **Inbox and @mentions.** Assignments, `@name` mentions, comments and status changes on your work
  arrive in a personal inbox over a per-user WebSocket.
- **Keyboard and accessibility.** `C` new task, `A` assistant, `Ctrl K` command bar; keyboard-operable
  cards and rows, visible focus, labelled controls, an alert dialog before delete, reduced-motion support.
- **Light and dark.** Follows the OS setting, with a toggle in the account menu.
- **Audit trail.** Field-level activity log (who changed what, from what, to what) and comments.
- **Multi-tenant.** Workspaces, owner/admin/member/viewer roles, JWT auth.

| Sprint and forecast | Insights and risks |
|---|---|
| ![Sprint](docs/screenshots/4-sprint.png) | ![Insights](docs/screenshots/5-insights.png) |
| **Timeline and critical path** | **Task details** |
| ![Timeline](docs/screenshots/3-timeline.png) | ![Drawer](docs/screenshots/6-task-drawer.png) |
| **Project assistant** | **New task with triage** |
| ![Assistant](docs/screenshots/7-assistant.png) | ![New task](docs/screenshots/8-new-task.png) |
| **My day** | **Find or ask** |
| ![My day](docs/screenshots/9-my-day.png) | ![Command bar](docs/screenshots/10-command-bar.png) |
| **Dark theme** | **Sign in** |
| ![Dark board](docs/screenshots/11-dark-board.png) | ![Sign in](docs/screenshots/0-login.png) |

The visual system (type, colour, glyphs, motion) is documented in [DESIGN.md](DESIGN.md).

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript, Vite, plain CSS with design tokens, hand-drawn SVG charts and glyphs, native drag-and-drop |
| Backend | FastAPI, Pydantic v2, SQLAlchemy 2, WebSockets, JWT + bcrypt |
| AI | Anthropic Python SDK, Claude Opus 5.5, tool-use agent loop, structured outputs, fallbacks |
| Database | PostgreSQL 16 (SQLite for zero-setup development and tests) |
| Quality | 36 pytest tests (including the agent loop with a scripted fake Claude client) on SQLite and PostgreSQL, GitHub Actions CI |
| Deploy | Multi-stage Dockerfile (one image serves API and SPA), docker-compose with Postgres |

## Run it

**Docker.** Starts Postgres, seeds a demo workspace and serves everything on port 8000:

```bash
export ANTHROPIC_API_KEY=sk-ant-...   # optional: enables the AI features
docker compose up --build
# open http://localhost:8000 and choose "Open the demo workspace"
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

Demo login: `demo@kairos.dev` / `demo1234`. The other seeded people (`dor@`, `noa@`, `amit@kairos.dev`)
use the same password; open two browsers to watch real-time sync.

**Tests**

```bash
cd backend && pytest -q
TEST_DATABASE_URL=postgresql+psycopg://user:pass@localhost/kairos_test pytest -q   # against Postgres
```

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `DATABASE_URL` | `sqlite:///./kairos.db` | SQLAlchemy URL, e.g. `postgresql+psycopg://...` |
| `KAIROS_SECRET` | dev value | JWT signing key. **Set a long random value in production.** |
| `KAIROS_TOKEN_HOURS` | `72` | Token lifetime |
| `KAIROS_WEEKEND` | `5,6` | Non-working weekdays (Mon=0). Use `4,5` for a Fri/Sat weekend |
| `KAIROS_CORS` | `http://localhost:5173` | Allowed origins for the dev server |
| `ANTHROPIC_API_KEY` | unset | Enables the AI features (assistant, subtasks, capture, triage, reports, day plan) |
| `KAIROS_AI_MODEL` | `claude-opus-5-5` | Claude model used by the AI features |

## Project structure

```
backend/app/
  models.py          relational schema
  routers/           auth, workspaces, projects, tasks, sprints, analytics, ai, me (inbox, my work, search)
  services/          ordering (fractional ranks), activity log, notify (inbox + @mentions), scheduling (CPM), forecast (Monte Carlo)
  ai/                client (Claude SDK wrapper), tools (agent toolbox), copilot (agent loop + AI features)
  realtime.py        WebSocket fan-out per project and per user
  seed.py            demo workspace
frontend/src/
  store.tsx          project state + real-time sync
  views/             MyDay, Board, ListView, Timeline, SprintView, Insights
  components/        CommandPalette, Copilot, TaskCard, TaskDrawer, NewTask, Confirm, Charts, Icons
docs/                architecture notes, screenshots
DESIGN.md            visual system
```

## Design decisions

* **States carry a semantic group** (backlog, unstarted, started, completed, cancelled), so teams can
  rename columns freely while analytics stays correct.
* **Per-project task keys** (`PLS-42`) from a project counter with a unique constraint.
* **Float ranks for drag-and-drop.** A move writes one row; columns are renumbered when the gap
  between neighbours collapses.
* **Field-level activity log** powering the audit trail, burndown and throughput history.
* **Dependencies with cycle detection on insert**, feeding critical-path scheduling, the forecast and
  the risk list, with the assistant on top.

See [docs/architecture.md](docs/architecture.md).

## License

MIT

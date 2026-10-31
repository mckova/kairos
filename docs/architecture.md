# Architecture

```
 React 19 + TypeScript (Vite)                FastAPI (Python 3.12)                 PostgreSQL 16
 ┌───────────────────────────┐  REST/JSON   ┌───────────────────────────┐  SQLAlchemy 2  ┌──────────────┐
 │ Board · List · Timeline   │ ───────────► │ routers/  auth, workspaces│ ─────────────► │ 12 tables    │
 │ Sprints · Insights        │              │   projects, tasks, sprints│                │ FK + unique  │
 │ ProjectProvider (store)   │ ◄─────────── │   analytics               │                │ constraints  │
 │ useProjectSocket          │  WebSocket   │ services/ ordering,       │                └──────────────┘
 └───────────────────────────┘  per project │   activity, scheduling,   │   (SQLite for dev/tests)
                                            │   forecast                │
                                            │ realtime.Hub (fan-out)    │
                                            └───────────────────────────┘
```

## AI layer

```
 Copilot panel ──POST /ai/chat──► run_copilot()  ──► Claude Opus 5.5 (tools, adaptive thinking, fallbacks="default")
                                     │  ▲                     │ tool_use
                                     │  └── tool_result ◄─────┘
                                     ▼
                                 Toolbox.run(name, input) ──► same router functions as the REST API
                                                              (role checks, validation, activity log, WebSocket)
```

* `ai/client.py` - SDK wrapper: model `claude-opus-5-5` (env `KAIROS_AI_MODEL`), server-side refusal
  fallbacks, refusal -> HTTP 503, injectable client for tests.
* `ai/tools.py` - 8 tools with JSON schemas. Tasks are addressed by human keys (`PLS-12`), statuses by name;
  errors (unknown key, 403 for viewers, circular dependency) are returned to the model as `is_error`
  tool results so it can correct itself.
* `ai/copilot.py` - the agent loop (max 12 turns; assistant content, including thinking blocks, is
  appended unchanged), plus three single-call features using structured JSON output: task breakdown,
  natural-language task capture, and the sprint status report.
* The server is stateless: the browser sends the visible chat history with each request.

## Data model

```
Workspace 1─* Membership *─1 User          (role: owner/admin/member/viewer, weekly_capacity)
Workspace 1─* Project 1─* State            (group: backlog/unstarted/started/completed/cancelled, wip_limit)
                    1─* Label
                    1─* Sprint             (planned/active/closed; one active per project)
                    1─* Task *─* Label     (number → PLS-12, rank, estimate, dates, parent_id)
                    1─* Dependency         (blocker → blocked, acyclic)
Task 1─* Comment, Task 1─* TaskActivity    (verb, field, old_value, new_value)
```

## Request flow (drag a card)

1. Board computes the drop index from the cursor position and sends `POST /tasks/{id}/move`
   with `state_id`, `before_id`, `after_id`. The card moves immediately (optimistic update).
2. API checks membership/role, validates neighbours are in the target column, sets
   `rank = (above + below) / 2` (renumbering the column if the gap is < 1e-6), records a
   `state` activity and sets/clears `completed_at` from the state group.
3. `hub.publish(project_id, "task.moved", task)` fans the change out to every open tab of that
   project; other users see the card move and a toast ("Dor moved PLS-8").

## Security

* bcrypt password hashing, short-lived HS256 JWT (`KAIROS_SECRET`, `KAIROS_TOKEN_HOURS`).
* Every project-scoped endpoint goes through `load_project(..., min_role)`, so a user outside the
  workspace gets 404 (no existence leak) and a viewer gets 403 on writes.
* Cross-project references (state, sprint, label, parent, assignee) are validated on every write.
* The WebSocket authenticates with the same JWT and checks workspace membership before joining.
* The SPA fallback route resolves paths and refuses anything outside the build directory.

## Analytics

| Endpoint | Purpose |
|---|---|
| `GET /analytics/summary` | Completion, open work by priority, status flow, 8-week throughput, lead time |
| `GET /analytics/burndown` | Ideal vs. remaining points for each working day of a sprint |
| `GET /analytics/forecast?scope=sprint\|project` | Monte Carlo P(on time), P50/P85/P95 dates |
| `GET /analytics/critical-path` | CPM timings, slack, critical chain, projected finish |
| `GET /analytics/workload` | Open sprint points vs. remaining capacity per person |
| `GET /analytics/risks` | Ranked findings with suggested actions |

All analytics accept `as_of=YYYY-MM-DD` so results are reproducible.

## Scaling notes

The real-time hub is in-process; running several API replicas needs Redis pub/sub behind the
same `publish()` interface. Schema creation uses `create_all` for simplicity; a production
deployment would add Alembic migrations.

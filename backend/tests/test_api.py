from datetime import date, timedelta

from conftest import signup


def mk(ctx, title, **kw):
    r = ctx["c"].post(f"{ctx['base']}/tasks", json={"title": title, **kw}, headers=ctx["h"])
    assert r.status_code == 201, r.text
    return r.json()


def test_auth_flow(client):
    h, user = signup(client)
    assert client.get("/api/auth/me", headers=h).json()["email"] == "a@x.io"
    assert client.post("/api/auth/register", json={"email": "A@x.io", "name": "x", "password": "password123"}).status_code == 409
    assert client.post("/api/auth/login", json={"email": "a@x.io", "password": "wrong-pass"}).status_code == 401
    assert client.get("/api/auth/me").status_code == 401
    assert client.get("/api/auth/me", headers={"Authorization": "Bearer junk"}).status_code == 401


def test_project_defaults_and_keys(ctx):
    assert list(ctx["states"]) == ["Backlog", "To do", "In progress", "In review", "Done", "Cancelled"]
    t1, t2 = mk(ctx, "First"), mk(ctx, "Second")
    assert (t1["key"], t2["key"]) == ("APO-1", "APO-2")
    assert t1["state_id"] == ctx["states"]["To do"]
    assert t2["rank"] > t1["rank"]


def test_isolation_between_workspaces(ctx):
    c = ctx["c"]
    h2, _ = signup(c, "b@x.io", "Bob")
    assert c.get(f"{ctx['base']}/tasks", headers=h2).status_code == 404
    assert c.post(f"{ctx['base']}/tasks", json={"title": "x"}, headers=h2).status_code == 404


def test_viewer_cannot_write(ctx):
    c = ctx["c"]
    h2, _ = signup(c, "v@x.io", "Vic")
    r = c.post(f"/api/workspaces/{ctx['ws']['id']}/members", json={"email": "v@x.io", "role": "viewer"}, headers=ctx["h"])
    assert r.status_code == 201
    assert c.get(f"{ctx['base']}/tasks", headers=h2).status_code == 200
    assert c.post(f"{ctx['base']}/tasks", json={"title": "x"}, headers=h2).status_code == 403


def test_update_records_activity_and_completion(ctx):
    c, b = ctx["c"], ctx["base"]
    t = mk(ctx, "Write docs", estimate=3)
    r = c.patch(f"{b}/tasks/{t['id']}", json={"state_id": ctx["states"]["Done"], "priority": "high"}, headers=ctx["h"])
    assert r.status_code == 200 and r.json()["completed_at"] is not None
    acts = c.get(f"{b}/tasks/{t['id']}/activity", headers=ctx["h"]).json()
    fields = {(a["verb"], a["field"]) for a in acts}
    assert ("created", None) in fields and ("updated", "state") in fields and ("updated", "priority") in fields
    state_change = next(a for a in acts if a["field"] == "state")
    assert (state_change["old_value"], state_change["new_value"]) == ("To do", "Done")
    r = c.patch(f"{b}/tasks/{t['id']}", json={"state_id": ctx["states"]["In progress"]}, headers=ctx["h"])
    assert r.json()["completed_at"] is None


def test_validation_of_cross_project_refs(ctx):
    c, b = ctx["c"], ctx["base"]
    other = c.post(f"/api/workspaces/{ctx['ws']['id']}/projects", json={"name": "Other", "key": "OTH"}, headers=ctx["h"]).json()
    r = c.post(f"{b}/tasks", json={"title": "x", "state_id": other["states"][0]["id"]}, headers=ctx["h"])
    assert r.status_code == 422
    r = c.post(f"{b}/tasks", json={"title": "x", "start_date": "2026-05-02", "due_date": "2026-05-01"}, headers=ctx["h"])
    assert r.status_code == 422


def test_drag_and_drop_ordering(ctx):
    c, b, s = ctx["c"], ctx["base"], ctx["states"]
    a, bb, cc = mk(ctx, "A"), mk(ctx, "B"), mk(ctx, "C")
    # Move C between A and B
    r = c.post(f"{b}/tasks/{cc['id']}/move", json={"state_id": s["To do"], "before_id": a["id"], "after_id": bb["id"]}, headers=ctx["h"])
    assert r.status_code == 200
    order = [t["title"] for t in c.get(f"{b}/tasks", params={"state_id": s["To do"]}, headers=ctx["h"]).json()]
    assert order == ["A", "C", "B"]
    # Move A to another column (empty) and it records a state change
    r = c.post(f"{b}/tasks/{a['id']}/move", json={"state_id": s["In progress"]}, headers=ctx["h"])
    assert r.json()["state_id"] == s["In progress"]
    # Many inserts at the same spot never break ordering (rebalance path)
    first = c.get(f"{b}/tasks", params={"state_id": s["To do"]}, headers=ctx["h"]).json()
    top, nxt = first[0], first[1]
    for i in range(60):
        t = mk(ctx, f"N{i}")
        c.post(f"{b}/tasks/{t['id']}/move", json={"state_id": s["To do"], "before_id": top["id"], "after_id": nxt["id"]}, headers=ctx["h"])
        nxt = t
    ranks = [t["rank"] for t in c.get(f"{b}/tasks", params={"state_id": s["To do"]}, headers=ctx["h"]).json()]
    assert len(set(ranks)) == len(ranks)


def test_dependencies_reject_cycles(ctx):
    c, b = ctx["c"], ctx["base"]
    x, y, z = mk(ctx, "X"), mk(ctx, "Y"), mk(ctx, "Z")
    assert c.post(f"{b}/dependencies", json={"blocker_id": x["id"], "blocked_id": y["id"]}, headers=ctx["h"]).status_code == 201
    assert c.post(f"{b}/dependencies", json={"blocker_id": y["id"], "blocked_id": z["id"]}, headers=ctx["h"]).status_code == 201
    assert c.post(f"{b}/dependencies", json={"blocker_id": z["id"], "blocked_id": x["id"]}, headers=ctx["h"]).status_code == 409
    assert c.post(f"{b}/dependencies", json={"blocker_id": x["id"], "blocked_id": x["id"]}, headers=ctx["h"]).status_code == 409
    assert c.get(f"{b}/tasks/{y['id']}", headers=ctx["h"]).json()["blocked_by"] == [x["id"]]


def test_filters_and_search(ctx):
    c, b = ctx["c"], ctx["base"]
    lbl = c.post(f"{b}/labels", json={"name": "Bug"}, headers=ctx["h"]).json()
    mk(ctx, "Login bug", label_ids=[lbl["id"]], priority="urgent")
    mk(ctx, "Pricing page")
    assert [t["title"] for t in c.get(f"{b}/tasks", params={"q": "login"}, headers=ctx["h"]).json()] == ["Login bug"]
    assert [t["title"] for t in c.get(f"{b}/tasks", params={"q": "APO-2"}, headers=ctx["h"]).json()] == ["Pricing page"]
    assert len(c.get(f"{b}/tasks", params={"label_id": lbl["id"]}, headers=ctx["h"]).json()) == 1
    assert len(c.get(f"{b}/tasks", params={"priority": "urgent"}, headers=ctx["h"]).json()) == 1


def test_sprint_lifecycle(ctx):
    c, b, s = ctx["c"], ctx["base"], ctx["states"]
    today = date.today()
    sp = c.post(f"{b}/sprints", json={"name": "S1", "start_date": str(today), "end_date": str(today + timedelta(days=10)), "status": "active"}, headers=ctx["h"]).json()
    bad = c.post(f"{b}/sprints", json={"name": "S2", "start_date": str(today), "end_date": str(today + timedelta(days=3)), "status": "active"}, headers=ctx["h"])
    assert bad.status_code == 409
    done = mk(ctx, "done", sprint_id=sp["id"], state_id=s["Done"])
    todo = mk(ctx, "todo", sprint_id=sp["id"])
    c.patch(f"{b}/sprints/{sp['id']}", json={"status": "closed"}, headers=ctx["h"])
    assert c.get(f"{b}/tasks/{todo['id']}", headers=ctx["h"]).json()["sprint_id"] is None
    assert c.get(f"{b}/tasks/{done['id']}", headers=ctx["h"]).json()["sprint_id"] == sp["id"]


def test_comments(ctx):
    c, b = ctx["c"], ctx["base"]
    t = mk(ctx, "Discuss")
    c.post(f"{b}/tasks/{t['id']}/comments", json={"body": "Looks good"}, headers=ctx["h"])
    cm = c.get(f"{b}/tasks/{t['id']}/comments", headers=ctx["h"]).json()
    assert cm[0]["body"] == "Looks good" and cm[0]["author"]["name"] == "Alice"


def test_analytics_endpoints(ctx):
    c, b, s = ctx["c"], ctx["base"], ctx["states"]
    today = date.today()
    sp = c.post(f"{b}/sprints", json={"name": "S1", "start_date": str(today - timedelta(days=5)), "end_date": str(today + timedelta(days=9)), "status": "active"}, headers=ctx["h"]).json()
    a = mk(ctx, "A", estimate=3, sprint_id=sp["id"], state_id=s["Done"])
    bt = mk(ctx, "B", estimate=5, sprint_id=sp["id"])
    ct = mk(ctx, "C", estimate=2, sprint_id=sp["id"], due_date=str(today - timedelta(days=1)))
    c.post(f"{b}/dependencies", json={"blocker_id": bt["id"], "blocked_id": ct["id"]}, headers=ctx["h"])
    h = ctx["h"]
    summ = c.get(f"{b}/analytics/summary", headers=h).json()
    assert summ["scope_points"] == 10 and summ["done_points"] == 3 and summ["overdue"] == 1
    bd = c.get(f"{b}/analytics/burndown", headers=h).json()
    assert bd["scope"] == 10 and bd["series"][0]["ideal"] == 10
    cp = c.get(f"{b}/analytics/critical-path", headers=h).json()
    assert cp["chain"] == ["APO-2", "APO-3"] and cp["length_days"] == 7
    fc = c.get(f"{b}/analytics/forecast", headers=h).json()
    assert fc["remaining_points"] == 7
    risks = c.get(f"{b}/analytics/risks", headers=h).json()
    kinds = {f["kind"] for f in risks["findings"]}
    assert "overdue" in kinds
    wl = c.get(f"{b}/analytics/workload", headers=h).json()
    assert wl["unassigned_points"] == 7


def test_websocket_broadcast(ctx):
    c, b = ctx["c"], ctx["base"]
    token = ctx["h"]["Authorization"].split()[1]
    with c.websocket_connect(f"/ws/projects/{ctx['p']['id']}?token={token}") as ws:
        mk(ctx, "Realtime!")
        msg = ws.receive_json()
        assert msg["event"] == "task.created" and msg["data"]["title"] == "Realtime!"


def test_risk_radar_suggests_rebalance(ctx):
    c, b, h = ctx["c"], ctx["base"], ctx["h"]
    h2, bob = signup(c, "bob@x.io", "Bob")
    c.post(f"/api/workspaces/{ctx['ws']['id']}/members", json={"email": "bob@x.io"}, headers=h)
    today = date.today()
    sp = c.post(f"{b}/sprints", json={"name": "S", "start_date": str(today), "end_date": str(today + timedelta(days=6)), "status": "active"}, headers=h).json()
    me = ctx["user"]["id"]
    for pts in (13, 8, 2):
        mk(ctx, f"t{pts}", estimate=pts, sprint_id=sp["id"], assignee_id=me)
    findings = c.get(f"{b}/analytics/risks", headers=h).json()["findings"]
    over = next(f for f in findings if f["kind"] == "overloaded")
    assert over["key"] == "APO-3" and "Bob" in over["action"]

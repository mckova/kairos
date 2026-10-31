import os
import sys
import tempfile
from pathlib import Path

_tmp = tempfile.mkdtemp()
os.environ["DATABASE_URL"] = os.getenv("TEST_DATABASE_URL") or f"sqlite:///{_tmp}/test.db"
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.db import Base, engine  # noqa: E402
from app.main import app  # noqa: E402


@pytest.fixture()
def client():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    with TestClient(app) as c:
        yield c


def signup(c, email="a@x.io", name="Alice"):
    r = c.post("/api/auth/register", json={"email": email, "name": name, "password": "password123"})
    assert r.status_code == 201, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}, r.json()["user"]


@pytest.fixture()
def ctx(client):
    """A user with a workspace and one project."""
    h, user = signup(client)
    ws = client.post("/api/workspaces", json={"name": "Team", "slug": "team"}, headers=h).json()
    p = client.post(f"/api/workspaces/{ws['id']}/projects", json={"name": "Apollo", "key": "APO"}, headers=h).json()
    states = {s["name"]: s["id"] for s in p["states"]}
    return {"c": client, "h": h, "user": user, "ws": ws, "p": p, "states": states, "base": f"/api/projects/{p['id']}"}

import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .auth import decode_token
from .db import Base, SessionLocal, engine
from .models import Membership, Project
from .realtime import hub
from .routers import ai, analytics, auth, me, projects, sprints, tasks, workspaces


@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(engine)
    yield


app = FastAPI(title="Kairos", version="1.0.0", description="AI-native project management API", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("KAIROS_CORS", "http://localhost:5173").split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
for r in (auth, workspaces, projects, tasks, sprints, analytics, ai, me):
    app.include_router(r.router)


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.websocket("/ws/projects/{project_id}")
async def project_socket(ws: WebSocket, project_id: int, token: str):
    try:
        user_id = decode_token(token)
    except Exception:
        await ws.close(code=4401)
        return
    with SessionLocal() as db:
        p = db.get(Project, project_id)
        ok = p is not None and db.query(Membership).filter_by(workspace_id=p.workspace_id, user_id=user_id).first()
    if not ok:
        await ws.close(code=4403)
        return
    await ws.accept()
    await hub.join(project_id, ws)
    try:
        while True:
            await ws.receive_text()  # keepalive pings from the client
    except WebSocketDisconnect:
        pass
    finally:
        hub.leave(project_id, ws)


@app.websocket("/ws/me")
async def user_socket(ws: WebSocket, token: str):
    """Personal channel: inbox notifications for the signed-in user."""
    try:
        user_id = decode_token(token)
    except Exception:
        await ws.close(code=4401)
        return
    await ws.accept()
    channel = f"user:{user_id}"
    await hub.join(channel, ws)
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        hub.leave(channel, ws)


# Serve the built SPA when present (single-container deployment).
DIST = Path(os.getenv("KAIROS_STATIC", Path(__file__).resolve().parents[2] / "frontend" / "dist"))
if DIST.is_dir():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        f = (DIST / path).resolve()
        safe = f.is_relative_to(DIST.resolve()) and f.is_file()
        return FileResponse(f if path and safe else DIST / "index.html")

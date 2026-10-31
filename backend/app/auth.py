"""Password hashing, JWT issuing and the request-scoped auth dependencies."""
import os
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from .db import get_db
from .models import Membership, Project, Role, User

SECRET = os.getenv("KAIROS_SECRET", "dev-only-insecure-secret-change-me-in-production")
ALGO = "HS256"
TOKEN_TTL = timedelta(hours=int(os.getenv("KAIROS_TOKEN_HOURS", "72")))

_bearer = HTTPBearer(auto_error=False)


def hash_password(raw: str) -> str:
    return bcrypt.hashpw(raw.encode(), bcrypt.gensalt(rounds=10)).decode()


def verify_password(raw: str, hashed: str) -> bool:
    return bcrypt.checkpw(raw.encode(), hashed.encode())


def issue_token(user_id: int) -> str:
    now = datetime.now(timezone.utc)
    return jwt.encode({"sub": str(user_id), "iat": now, "exp": now + TOKEN_TTL}, SECRET, algorithm=ALGO)


def decode_token(token: str) -> int:
    try:
        return int(jwt.decode(token, SECRET, algorithms=[ALGO])["sub"])
    except (jwt.PyJWTError, KeyError, ValueError):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired token")


def current_user(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer), db: Session = Depends(get_db)
) -> User:
    if creds is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing bearer token")
    user = db.get(User, decode_token(creds.credentials))
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "User no longer exists")
    return user


_RANK = {Role.viewer: 0, Role.member: 1, Role.admin: 2, Role.owner: 3}


def require_membership(db: Session, user: User, workspace_id: int, min_role: Role = Role.viewer) -> Membership:
    m = db.query(Membership).filter_by(workspace_id=workspace_id, user_id=user.id).one_or_none()
    if m is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Workspace not found")
    if _RANK[m.role] < _RANK[min_role]:
        raise HTTPException(status.HTTP_403_FORBIDDEN, f"Requires {min_role.value} role")
    return m


def load_project(db: Session, user: User, project_id: int, min_role: Role = Role.viewer) -> Project:
    project = db.get(Project, project_id)
    if project is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Project not found")
    require_membership(db, user, project.workspace_id, min_role)
    return project

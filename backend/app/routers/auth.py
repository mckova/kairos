import random

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..auth import current_user, hash_password, issue_token, verify_password
from ..db import get_db
from ..models import User
from ..schemas import LoginIn, RegisterIn, TokenOut, UserOut

router = APIRouter(prefix="/api/auth", tags=["auth"])

_COLORS = ["#6366f1", "#ec4899", "#14b8a6", "#f59e0b", "#8b5cf6", "#ef4444", "#0ea5e9", "#22c55e"]


@router.post("/register", response_model=TokenOut, status_code=201)
def register(body: RegisterIn, db: Session = Depends(get_db)):
    if db.query(User).filter_by(email=body.email.lower()).first():
        raise HTTPException(status.HTTP_409_CONFLICT, "Email already registered")
    user = User(
        email=body.email.lower(),
        name=body.name,
        password_hash=hash_password(body.password),
        avatar_color=random.choice(_COLORS),
    )
    db.add(user)
    db.commit()
    return TokenOut(access_token=issue_token(user.id), user=UserOut.model_validate(user))


@router.post("/login", response_model=TokenOut)
def login(body: LoginIn, db: Session = Depends(get_db)):
    user = db.query(User).filter_by(email=body.email.lower()).first()
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Wrong email or password")
    return TokenOut(access_token=issue_token(user.id), user=UserOut.model_validate(user))


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(current_user)):
    return user

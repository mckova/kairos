"""Seed demo data on first boot only (used by the Docker image)."""
from .db import Base, SessionLocal, engine
from .models import User
from . import seed

if __name__ == "__main__":
    Base.metadata.create_all(engine)
    with SessionLocal() as db:
        empty = db.query(User).count() == 0
    if empty:
        seed.run()
    else:
        print("Database already has data - skipping demo seed.")

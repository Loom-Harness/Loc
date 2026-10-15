"""Async SQLAlchemy engine + per-request session factory."""

from collections.abc import AsyncIterator
from contextvars import ContextVar

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.settings import DATABASE_URL

engine = create_async_engine(DATABASE_URL)
session_factory = async_sessionmaker(engine, expire_on_commit=False)

# The request-scoped session, owned + committed by TransactionMiddleware
# (app/db/transaction.py) BEFORE the response starts, so a client that reads
# its own write (read-after-create) can't race the commit.
request_session: ContextVar[AsyncSession | None] = ContextVar(
    "loom_request_session", default=None
)


async def get_session() -> AsyncIterator[AsyncSession]:
    """One session — and exactly one transaction — per request.

    Repositories flush; the commit is done by TransactionMiddleware just
    before the response starts — NOT in this dependency's teardown, which
    FastAPI runs AFTER the response is sent (the read-after-create race).
    Off the request path (seeds, CLI) there is no middleware, so fall back
    to owning the session and committing on exit.
    """
    existing = request_session.get()
    if existing is not None:
        yield existing
        return
    async with session_factory() as session:
        yield session
        await session.commit()

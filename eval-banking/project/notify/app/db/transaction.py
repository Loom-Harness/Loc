"""Per-request transaction boundary (pure-ASGI).  Auto-generated.

Owns exactly one session/transaction per HTTP request and commits it
*before* the response starts — not in a FastAPI `yield`-dependency
teardown, which runs AFTER the response is sent and lets a client racing
a read against its own just-committed write see a 404 / stale FK.

On a success status (< 400) the session is committed before the first
response byte leaves; on an error status (or an exception) it is rolled
back.  Repositories/handlers pull this session via `get_session`
(app/db/engine.py) off the `request_session` ContextVar.
"""

from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.db.engine import request_session, session_factory


class TransactionMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async with session_factory() as session:
            token = request_session.set(session)
            finalized = False

            async def send_wrapper(message: Message) -> None:
                nonlocal finalized
                if message["type"] == "http.response.start" and not finalized:
                    finalized = True
                    if message["status"] < 400:
                        await session.commit()
                    else:
                        await session.rollback()
                await send(message)

            try:
                await self.app(scope, receive, send_wrapper)
            except BaseException:
                if not finalized:
                    await session.rollback()
                raise
            finally:
                request_session.reset(token)

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from starlette.exceptions import HTTPException

from app.api import (
    calibrations,
    evaluations,
    export,
    health,
    history,
    profile,
    sessions,
    summaries,
    voice,
)
from app.db.session import init_db


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    yield


app = FastAPI(title="memo", version="0.1.0", lifespan=lifespan)
for module in [
    health,
    profile,
    calibrations,
    sessions,
    evaluations,
    history,
    summaries,
    voice,
    export,
]:
    app.include_router(module.router, prefix="/api")


@app.exception_handler(HTTPException)
async def http_error(_request: Request, exc: HTTPException):
    detail = (
        exc.detail
        if isinstance(exc.detail, dict)
        else {"code": "http_error", "message": str(exc.detail)}
    )
    return JSONResponse({"error": detail}, status_code=exc.status_code)


@app.exception_handler(RequestValidationError)
async def validation_error(_request: Request, _exc: RequestValidationError):
    return JSONResponse(
        {"error": {"code": "validation_error", "message": "Invalid request"}}, status_code=422
    )


STATIC_DIR = Path(__file__).parents[1] / "static"


@app.get("/{path:path}", include_in_schema=False)
def spa(path: str):
    if path == "api" or path.startswith("api/"):
        raise HTTPException(404, "API route not found")
    candidate = (STATIC_DIR / path).resolve()
    if not candidate.is_relative_to(STATIC_DIR.resolve()):
        raise HTTPException(404, "Not found")
    if candidate.is_file():
        return FileResponse(candidate)
    # Missing assets must not return HTML as JavaScript.
    if Path(path).suffix:
        raise HTTPException(404, "Asset not found")
    index = STATIC_DIR / "index.html"
    if index.is_file():
        return FileResponse(index)
    raise HTTPException(404, "Run make build to serve the frontend")

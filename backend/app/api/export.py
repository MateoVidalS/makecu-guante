from datetime import datetime, timezone
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Response
from sqlmodel import Session as DbSession

from app.db import repo
from app.db.session import get_session

router = APIRouter()


@router.get("/export", response_model=None)
def get_export(
    db: Annotated[DbSession, Depends(get_session)], format: Literal["json", "csv"] = "json"
) -> Response:
    filename = f"rehab-hub-export-{datetime.now(timezone.utc):%Y%m%d}.{format}"
    return Response(
        repo.export_data(db, format),
        media_type="application/json" if format == "json" else "text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )

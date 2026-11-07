from fastapi import HTTPException


def not_implemented():
    raise HTTPException(501, detail={"code": "not_implemented", "message": "Coming in WP5"})

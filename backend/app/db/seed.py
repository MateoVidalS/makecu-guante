from sqlmodel import Session

from app.db.models import Profile


def seed(session: Session) -> None:
    """Only an empty singleton profile; demo data is explicitly opt-in in WP11."""
    if session.get(Profile, 1) is None:
        session.add(Profile())
        session.commit()

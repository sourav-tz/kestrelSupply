from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

import bcrypt
import jwt
from fastapi import Depends, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.exceptions import AppError
from app.db.base import get_db

bearer_scheme = HTTPBearer(auto_error=False)


def hash_password(password: str) -> str:
    salt = bcrypt.gensalt(rounds=12)
    return bcrypt.hashpw(password.encode("utf-8"), salt).decode("utf-8")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    try:
        return bcrypt.checkpw(plain_password.encode("utf-8"), hashed_password.encode("utf-8"))
    except ValueError:
        return False


def create_access_token(subject: str, role: str, extra_claims: Optional[Dict[str, Any]] = None) -> str:
    settings = get_settings()
    now = datetime.now(timezone.utc)
    expire = now + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    payload: Dict[str, Any] = {
        "sub": subject,
        "role": role,
        "iat": int(now.timestamp()),
        "exp": int(expire.timestamp()),
    }
    if extra_claims:
        payload.update(extra_claims)
    return jwt.encode(payload, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def decode_access_token(token: str) -> Dict[str, Any]:
    settings = get_settings()
    try:
        return jwt.decode(token, settings.JWT_SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
    except jwt.ExpiredSignatureError as exc:
        raise AppError(status.HTTP_401_UNAUTHORIZED, "token_expired", "Session expired. Please sign in again.") from exc
    except jwt.InvalidTokenError as exc:
        raise AppError(status.HTTP_401_UNAUTHORIZED, "invalid_token", "Invalid authentication credentials.") from exc


def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
    db: Session = Depends(get_db),
):
    from app.db.models import User

    if not credentials or not credentials.credentials:
        raise AppError(status.HTTP_401_UNAUTHORIZED, "not_authenticated", "Authentication required.")
    payload = decode_access_token(credentials.credentials)
    user_id = payload.get("sub")
    if not user_id:
        raise AppError(status.HTTP_401_UNAUTHORIZED, "invalid_token", "Malformed token payload.")
    user = db.get(User, user_id)
    if not user:
        raise AppError(status.HTTP_401_UNAUTHORIZED, "user_not_found", "Authenticated account no longer exists.")
    return user


def require_staff(current_user=Depends(get_current_user)):
    if current_user.role not in ("support_agent", "admin"):
        raise AppError(
            status.HTTP_403_FORBIDDEN,
            "insufficient_permissions",
            "Support staff or administrator privileges are required for this action.",
        )
    return current_user

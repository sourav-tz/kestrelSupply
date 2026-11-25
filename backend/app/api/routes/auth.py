from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.core.exceptions import AppError
from app.core.security import create_access_token, get_current_user, hash_password, verify_password
from app.db.base import get_db
from app.db.models import User
from app.schemas.auth import AuthTokenResponse, LoginRequest, RegisterRequest, UserResponse
from app.services.audit_service import record_audit_event

router = APIRouter(prefix="/auth", tags=["Authentication"])


@router.post("/register", response_model=AuthTokenResponse, status_code=status.HTTP_201_CREATED)
def register(payload: RegisterRequest, db: Session = Depends(get_db)):
    normalized_email = payload.email.strip().lower()
    if db.query(User).filter(User.email == normalized_email).first():
        raise AppError(status.HTTP_409_CONFLICT, "email_exists", "An account with this email already exists.")

    user = User(
        name=payload.name.strip(),
        email=normalized_email,
        password_hash=hash_password(payload.password),
        role="customer",  # Public self-registration always creates customer accounts
    )
    db.add(user)
    db.flush()
    record_audit_event(
        db,
        actor_id=user.id,
        actor_role=user.role,
        action="user_registered",
        resource_type="user",
        resource_id=user.id,
    )
    db.commit()
    db.refresh(user)
    token = create_access_token(user.id, user.role)
    return AuthTokenResponse(access_token=token, user=UserResponse.model_validate(user))


@router.post("/login", response_model=AuthTokenResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    normalized_email = payload.email.strip().lower()
    user = db.query(User).filter(User.email == normalized_email).first()
    if not user or not verify_password(payload.password, user.password_hash):
        raise AppError(status.HTTP_401_UNAUTHORIZED, "invalid_credentials", "Invalid email or password.")

    token = create_access_token(user.id, user.role)
    record_audit_event(
        db,
        actor_id=user.id,
        actor_role=user.role,
        action="user_login",
        resource_type="user",
        resource_id=user.id,
    )
    db.commit()
    return AuthTokenResponse(access_token=token, user=UserResponse.model_validate(user))


@router.post("/logout")
def logout(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    record_audit_event(
        db,
        actor_id=current_user.id,
        actor_role=current_user.role,
        action="user_logout",
        resource_type="user",
        resource_id=current_user.id,
    )
    db.commit()
    return {"status": "logged_out"}


@router.get("/me", response_model=UserResponse)
def me(current_user: User = Depends(get_current_user)):
    return UserResponse.model_validate(current_user)

from typing import List
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.security import require_staff
from app.db.base import get_db
from app.db.models import AuditLog, User
from app.schemas.refund import AuditLogResponse

router = APIRouter(prefix="/audit-logs", tags=["Audit Logs"])


@router.get("", response_model=List[AuditLogResponse])
def get_audit_logs(
    limit: int = Query(default=100, ge=1, le=500),
    _: User = Depends(require_staff),
    db: Session = Depends(get_db),
):
    logs = db.query(AuditLog).order_by(AuditLog.created_at.desc()).limit(limit).all()
    return [AuditLogResponse.model_validate(item) for item in logs]

from typing import Any, Dict, Optional
from sqlalchemy.orm import Session

from app.core.logging import get_logger
from app.db.models import AuditLog

logger = get_logger("kestrel.audit")


def record_audit_event(
    db: Session,
    *,
    actor_id: Optional[str],
    actor_role: str,
    action: str,
    resource_type: str,
    resource_id: str,
    details: Optional[Dict[str, Any]] = None,
) -> AuditLog:
    entry = AuditLog(
        actor_id=actor_id,
        actor_role=actor_role,
        action=action,
        resource_type=resource_type,
        resource_id=resource_id,
        details_json=details or {},
    )
    db.add(entry)
    db.flush()
    logger.info(
        "audit_event",
        extra={
            "action": action,
            "resource_type": resource_type,
            "resource_id": resource_id,
            "actor_role": actor_role,
        },
    )
    return entry

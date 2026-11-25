from typing import List, Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.security import require_staff
from app.db.base import get_db
from app.db.models import User
from app.schemas.refund import EscalationDecisionRequest, EscalationResponse
from app.services.escalation_service import decide_escalation, list_escalations

router = APIRouter(prefix="/escalations", tags=["Escalations"])


@router.get("", response_model=List[EscalationResponse])
def get_escalations(
    decision: Optional[str] = Query(default=None),
    _: User = Depends(require_staff),
    db: Session = Depends(get_db),
):
    items = list_escalations(db, decision=decision)
    return [EscalationResponse.model_validate(item) for item in items]


@router.post("/{escalation_id}/decision", response_model=EscalationResponse)
def post_escalation_decision(
    escalation_id: str,
    payload: EscalationDecisionRequest,
    staff_user: User = Depends(require_staff),
    db: Session = Depends(get_db),
):
    updated = decide_escalation(
        db,
        escalation_id=escalation_id,
        reviewer=staff_user,
        decision=payload.decision,
        internal_note=payload.internal_note,
        customer_message=payload.customer_message,
    )
    return EscalationResponse.model_validate(updated)

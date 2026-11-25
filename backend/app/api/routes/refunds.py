from typing import List, Optional
from fastapi import APIRouter, Depends, Header, status
from sqlalchemy.orm import Session

from app.core.security import get_current_user, require_staff
from app.db.base import get_db
from app.db.models import Refund, Ticket, User
from app.schemas.refund import RefundCreateRequest, RefundDecisionRequest, RefundResponse
from app.services.order_service import get_order_details
from app.services.refund_service import process_refund, review_refund_decision
from app.services.ticket_service import create_ticket

router = APIRouter(prefix="/refunds", tags=["Refunds"])


@router.get("", response_model=List[RefundResponse])
def list_refunds(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    query = db.query(Refund)
    if current_user.role == "customer":
        query = query.filter(Refund.requested_by == current_user.id)
    refunds = query.order_by(Refund.created_at.desc()).all()
    return [RefundResponse.model_validate(r) for r in refunds]


@router.post("", response_model=RefundResponse, status_code=status.HTTP_201_CREATED)
def create_refund_request(
    payload: RefundCreateRequest,
    idempotency_header: Optional[str] = Header(default=None, alias="Idempotency-Key"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    # Verify order access first
    order = get_order_details(db, payload.order_id, current_user)

    ticket_id = payload.ticket_id
    if not ticket_id:
        existing_ticket = (
            db.query(Ticket)
            .filter(Ticket.customer_id == current_user.id, Ticket.order_id == order.id)
            .order_by(Ticket.created_at.desc())
            .first()
        )
        if existing_ticket:
            ticket_id = existing_ticket.id
        else:
            new_ticket = create_ticket(
                db,
                customer=current_user,
                subject=f"Refund request for {order.id}",
                description=payload.reason,
                category="Refund Request",
                priority="medium",
                order_id=order.id,
            )
            ticket_id = new_ticket.id

    idem_key = payload.idempotency_key or idempotency_header
    result = process_refund(
        db,
        actor=current_user,
        order_id=order.id,
        ticket_id=ticket_id,
        amount=payload.amount,
        reason=payload.reason,
        idempotency_key=idem_key,
    )
    return RefundResponse.model_validate(result.refund)


@router.post("/{refund_id}/decision", response_model=RefundResponse)
def decide_refund(
    refund_id: str,
    payload: RefundDecisionRequest,
    staff_user: User = Depends(require_staff),
    db: Session = Depends(get_db),
):
    refund = review_refund_decision(
        db,
        refund_id=refund_id,
        reviewer=staff_user,
        decision=payload.decision,
        decision_note=payload.decision_note,
    )
    return RefundResponse.model_validate(refund)

from dataclasses import dataclass
from typing import Optional
import uuid

from fastapi import status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.exceptions import AppError
from app.db.models import Escalation, Message, Order, Refund, Ticket, User
from app.services.audit_service import record_audit_event
from app.services.policy_service import evaluate_order_eligibility


@dataclass
class RefundExecutionResult:
    refund: Refund
    escalation: Optional[Escalation]
    outcome: str  # "refund_processed" | "escalated_high_value" | "idempotent_replay"
    message: str


def process_refund(
    db: Session,
    *,
    actor: User,
    order_id: str,
    ticket_id: str,
    amount: Optional[float],
    reason: str,
    idempotency_key: Optional[str] = None,
) -> RefundExecutionResult:
    """
    Authoritative server-side refund engine.
    Enforces ownership, delivery verification, return window, idempotency,
    duplicate refund protection, and the ₹5,000 automated threshold.
    """
    settings = get_settings()
    normalized_order_id = order_id.strip().upper()
    clean_idem_key = (idempotency_key or "").strip() or f"idem-{uuid.uuid4().hex}"

    # 1. Idempotent replay check
    existing_by_key = db.query(Refund).filter(Refund.idempotency_key == clean_idem_key).first()
    if existing_by_key:
        if actor.role == "customer" and existing_by_key.requested_by != actor.id:
            raise AppError(status.HTTP_403_FORBIDDEN, "forbidden", "Access denied to refund record.")
        existing_esc = db.query(Escalation).filter(Escalation.refund_id == existing_by_key.id).first()
        return RefundExecutionResult(
            refund=existing_by_key,
            escalation=existing_esc,
            outcome="idempotent_replay",
            message=f"Existing refund {existing_by_key.id} returned for idempotency key.",
        )

    # 2. Verify order exists and belongs to customer (or staff)
    order = db.get(Order, normalized_order_id)
    if not order or (actor.role == "customer" and order.customer_id != actor.id):
        raise AppError(
            status.HTTP_404_NOT_FOUND,
            "order_not_accessible",
            f"Order {normalized_order_id} was not found for your account.",
        )

    ticket = db.get(Ticket, ticket_id)
    if not ticket or (actor.role == "customer" and ticket.customer_id != actor.id):
        raise AppError(status.HTTP_404_NOT_FOUND, "ticket_not_found", "Associated ticket not found.")

    requested_amount = round(float(amount if amount is not None else order.total_amount), 2)
    if requested_amount <= 0 or requested_amount > order.total_amount:
        raise AppError(
            status.HTTP_400_BAD_REQUEST,
            "invalid_refund_amount",
            f"Refund amount must be between ₹1.00 and ₹{order.total_amount:,.2f}.",
        )

    # 3. Duplicate active/processed refund protection per order
    existing_order_refund = (
        db.query(Refund)
        .filter(
            Refund.order_id == order.id,
            Refund.status.in_(["pending_review", "approved", "processed"]),
        )
        .first()
    )
    if existing_order_refund:
        raise AppError(
            status.HTTP_409_CONFLICT,
            "duplicate_refund",
            f"A refund ({existing_order_refund.id}, status: {existing_order_refund.status}) already exists for order {order.id}.",
        )

    # 4. Evaluate delivery & return window strictly on server
    eligibility = evaluate_order_eligibility(
        order,
        existing_refund_status=None,
        requested_amount=requested_amount,
    )
    if order.status != "delivered" or order.delivery_date is None:
        record_audit_event(
            db,
            actor_id=actor.id,
            actor_role=actor.role,
            action="refund_rejected_not_delivered",
            resource_type="order",
            resource_id=order.id,
            details={"ticket_id": ticket.id, "order_status": order.status},
        )
        db.commit()
        raise AppError(
            status.HTTP_400_BAD_REQUEST,
            "order_not_delivered",
            eligibility.reason,
        )

    if not eligibility.within_return_window:
        record_audit_event(
            db,
            actor_id=actor.id,
            actor_role=actor.role,
            action="refund_rejected_window_expired",
            resource_type="order",
            resource_id=order.id,
            details={
                "ticket_id": ticket.id,
                "days_since_delivery": eligibility.days_since_delivery,
                "return_window_days": eligibility.return_window_days,
            },
        )
        db.commit()
        raise AppError(
            status.HTTP_400_BAD_REQUEST,
            "return_window_expired",
            eligibility.reason,
        )

    # 5. Enforce ₹5,000 automated refund threshold
    if requested_amount > settings.AUTO_REFUND_LIMIT_INR:
        refund = Refund(
            order_id=order.id,
            ticket_id=ticket.id,
            amount=requested_amount,
            reason=reason.strip(),
            status="pending_review",
            idempotency_key=clean_idem_key,
            requested_by=order.customer_id,
            decision_note=(
                f"Queued for specialist review: ₹{requested_amount:,.2f} exceeds "
                f"₹{settings.AUTO_REFUND_LIMIT_INR:,.2f} automated approval threshold."
            ),
        )
        db.add(refund)
        try:
            db.flush()
        except IntegrityError as exc:
            db.rollback()
            raise AppError(
                status.HTTP_409_CONFLICT,
                "duplicate_refund",
                "Duplicate refund submission detected.",
            ) from exc

        escalation = Escalation(
            ticket_id=ticket.id,
            refund_id=refund.id,
            summary=(
                f"High-value refund request of ₹{requested_amount:,.2f} on {order.id} ({order.item_name}). "
                f"Return window verified ({eligibility.days_since_delivery}/{eligibility.return_window_days} days). "
                f"Requires human specialist approval."
            ),
            reason_code="high_value_refund",
            priority="high",
            decision="pending",
        )
        db.add(escalation)
        ticket.status = "escalated"
        ticket.priority = "high"
        if not ticket.order_id:
            ticket.order_id = order.id

        record_audit_event(
            db,
            actor_id=actor.id,
            actor_role=actor.role,
            action="refund_escalated_high_value",
            resource_type="refund",
            resource_id=refund.id,
            details={
                "order_id": order.id,
                "ticket_id": ticket.id,
                "escalation_id": escalation.id,
                "amount": requested_amount,
            },
        )
        db.commit()
        db.refresh(refund)
        db.refresh(escalation)
        return RefundExecutionResult(
            refund=refund,
            escalation=escalation,
            outcome="escalated_high_value",
            message=(
                f"Refund request {refund.id} for ₹{requested_amount:,.2f} exceeds the ₹{settings.AUTO_REFUND_LIMIT_INR:,.2f} "
                f"automated threshold. Escalation {escalation.id} has been created for human specialist approval."
            ),
        )

    # 6. Execute simulated automated refund (<= ₹5,000)
    refund = Refund(
        order_id=order.id,
        ticket_id=ticket.id,
        amount=requested_amount,
        reason=reason.strip(),
        status="processed",
        idempotency_key=clean_idem_key,
        requested_by=order.customer_id,
        decision_note=(
            f"Automated refund processed within {eligibility.return_window_days}-day {order.category} "
            f"return window and ₹{settings.AUTO_REFUND_LIMIT_INR:,.2f} limit."
        ),
    )
    db.add(refund)
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        raise AppError(
            status.HTTP_409_CONFLICT,
            "duplicate_refund",
            "Duplicate refund submission detected.",
        ) from exc

    ticket.status = "resolved"
    if not ticket.order_id:
        ticket.order_id = order.id

    record_audit_event(
        db,
        actor_id=actor.id,
        actor_role=actor.role,
        action="refund_processed",
        resource_type="refund",
        resource_id=refund.id,
        details={"order_id": order.id, "ticket_id": ticket.id, "amount": requested_amount, "mode": "automated"},
    )
    db.commit()
    db.refresh(refund)
    return RefundExecutionResult(
        refund=refund,
        escalation=None,
        outcome="refund_processed",
        message=(
            f"Refund {refund.id} for ₹{requested_amount:,.2f} on order {order.id} has been approved "
            "and processed to the original payment method."
        ),
    )


def review_refund_decision(
    db: Session,
    *,
    refund_id: str,
    reviewer: User,
    decision: str,
    decision_note: str,
) -> Refund:
    refund = db.get(Refund, refund_id)
    if not refund:
        raise AppError(status.HTTP_404_NOT_FOUND, "refund_not_found", "Refund record not found.")
    if refund.status not in ("pending_review",):
        raise AppError(
            status.HTTP_409_CONFLICT,
            "refund_already_reviewed",
            f"Refund {refund.id} is already in '{refund.status}' state.",
        )

    refund.status = "processed" if decision == "approved" else "rejected"
    refund.reviewed_by = reviewer.id
    refund.decision_note = decision_note.strip()

    linked_escalations = db.query(Escalation).filter(Escalation.refund_id == refund.id).all()
    for esc in linked_escalations:
        esc.decision = "approved" if decision == "approved" else "rejected"
        esc.assigned_to = reviewer.id
        esc.internal_note = decision_note.strip()

    ticket = db.get(Ticket, refund.ticket_id)
    if ticket:
        ticket.status = "resolved" if decision == "approved" else "closed"
        status_label = "approved and processed" if decision == "approved" else "declined"
        db.add(
            Message(
                ticket_id=ticket.id,
                sender_type="support_agent",
                sender_id=reviewer.id,
                content=(
                    f"Support specialist {reviewer.name} has {status_label} refund request {refund.id} "
                    f"(₹{refund.amount:,.2f} for order {refund.order_id}). Note: {decision_note.strip()}"
                ),
                metadata_json={"refund_id": refund.id, "decision": decision},
            )
        )

    record_audit_event(
        db,
        actor_id=reviewer.id,
        actor_role=reviewer.role,
        action=f"refund_{decision}",
        resource_type="refund",
        resource_id=refund.id,
        details={"order_id": refund.order_id, "amount": refund.amount, "note": decision_note.strip()},
    )
    db.commit()
    db.refresh(refund)
    return refund

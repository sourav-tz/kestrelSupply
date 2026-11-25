from typing import List, Optional
from fastapi import status
from sqlalchemy.orm import Session

from app.core.exceptions import AppError
from app.db.models import Escalation, InternalNote, Message, Refund, Ticket, User
from app.services.audit_service import record_audit_event


def escalate_to_human(
    db: Session,
    *,
    ticket_id: str,
    summary: str,
    priority: str = "high",
    reason_code: str = "manual_review",
    actor: Optional[User] = None,
    refund_id: Optional[str] = None,
) -> Escalation:
    ticket = db.get(Ticket, ticket_id)
    if not ticket:
        raise AppError(status.HTTP_404_NOT_FOUND, "ticket_not_found", "Ticket not found.")

    existing = (
        db.query(Escalation)
        .filter(Escalation.ticket_id == ticket_id, Escalation.decision == "pending")
        .first()
    )
    if existing:
        return existing

    esc = Escalation(
        ticket_id=ticket.id,
        refund_id=refund_id,
        summary=summary.strip(),
        reason_code=reason_code,
        priority=priority,
        decision="pending",
    )
    db.add(esc)
    ticket.status = "escalated"
    if priority in ("high", "urgent"):
        ticket.priority = priority
    db.flush()

    record_audit_event(
        db,
        actor_id=actor.id if actor else None,
        actor_role=actor.role if actor else "ai_agent",
        action="escalation_created",
        resource_type="escalation",
        resource_id=esc.id,
        details={"ticket_id": ticket.id, "reason_code": reason_code, "priority": priority},
    )
    db.commit()
    db.refresh(esc)
    return esc


def list_escalations(db: Session, decision: Optional[str] = None) -> List[Escalation]:
    query = db.query(Escalation)
    if decision:
        query = query.filter(Escalation.decision == decision)
    return query.order_by(Escalation.created_at.desc()).all()


def decide_escalation(
    db: Session,
    *,
    escalation_id: str,
    reviewer: User,
    decision: str,
    internal_note: str,
    customer_message: Optional[str] = None,
) -> Escalation:
    esc = db.get(Escalation, escalation_id)
    if not esc:
        raise AppError(status.HTTP_404_NOT_FOUND, "escalation_not_found", "Escalation record not found.")

    esc.decision = decision
    esc.assigned_to = reviewer.id
    esc.internal_note = internal_note.strip()

    ticket = db.get(Ticket, esc.ticket_id)
    if ticket:
        db.add(
            InternalNote(
                ticket_id=ticket.id,
                author_id=reviewer.id,
                note=f"[Escalation {esc.id} - {decision}] {internal_note.strip()}",
            )
        )

    if esc.refund_id and decision in ("approved", "rejected"):
        refund = db.get(Refund, esc.refund_id)
        if refund and refund.status == "pending_review":
            refund.status = "processed" if decision == "approved" else "rejected"
            refund.reviewed_by = reviewer.id
            refund.decision_note = internal_note.strip()
            record_audit_event(
                db,
                actor_id=reviewer.id,
                actor_role=reviewer.role,
                action=f"refund_{decision}",
                resource_type="refund",
                resource_id=refund.id,
                details={"escalation_id": esc.id, "amount": refund.amount},
            )

    if ticket:
        if decision == "approved":
            ticket.status = "resolved"
            default_msg = (
                f"Specialist {reviewer.name} approved your escalated request ({esc.id}). "
                "Your refund has been processed and will arrive within 3-5 business days."
            )
        elif decision == "rejected":
            ticket.status = "closed"
            default_msg = (
                f"Specialist {reviewer.name} reviewed escalation {esc.id} and could not approve the request. "
                f"Reason: {internal_note.strip()}"
            )
        else:
            ticket.status = "awaiting_customer"
            default_msg = (
                f"Specialist {reviewer.name} reviewed escalation {esc.id} and requested additional details "
                "before finalizing a decision. Please reply in this thread."
            )

        db.add(
            Message(
                ticket_id=ticket.id,
                sender_type="support_agent",
                sender_id=reviewer.id,
                content=(customer_message or "").strip() or default_msg,
                metadata_json={"escalation_id": esc.id, "decision": decision},
            )
        )

    record_audit_event(
        db,
        actor_id=reviewer.id,
        actor_role=reviewer.role,
        action=f"escalation_{decision}",
        resource_type="escalation",
        resource_id=esc.id,
        details={"ticket_id": esc.ticket_id, "note": internal_note.strip()},
    )
    db.commit()
    db.refresh(esc)
    return esc

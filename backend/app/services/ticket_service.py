from typing import List, Optional
from fastapi import status
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.core.exceptions import AppError
from app.db.models import InternalNote, Message, Order, Ticket, User
from app.services.audit_service import record_audit_event
from app.services.order_service import to_order_response


def create_ticket(
    db: Session,
    *,
    customer: User,
    subject: str,
    description: str,
    category: str,
    priority: str,
    order_id: Optional[str] = None,
) -> Ticket:
    normalized_order_id = order_id.strip().upper() if order_id else None
    if normalized_order_id:
        order = db.get(Order, normalized_order_id)
        if not order or order.customer_id != customer.id:
            raise AppError(
                status.HTTP_404_NOT_FOUND,
                "order_not_accessible",
                f"Order {normalized_order_id} was not found for your account.",
            )

    ticket = Ticket(
        customer_id=customer.id,
        order_id=normalized_order_id,
        subject=subject.strip(),
        description=description.strip(),
        category=category,
        status="open",
        priority=priority,
    )
    db.add(ticket)
    db.flush()

    initial_msg = Message(
        ticket_id=ticket.id,
        sender_type="customer",
        sender_id=customer.id,
        content=description.strip(),
        metadata_json={"initial_submission": True},
    )
    db.add(initial_msg)

    record_audit_event(
        db,
        actor_id=customer.id,
        actor_role=customer.role,
        action="ticket_created",
        resource_type="ticket",
        resource_id=ticket.id,
        details={"order_id": normalized_order_id, "category": category},
    )
    db.commit()
    db.refresh(ticket)
    return ticket


def list_tickets(
    db: Session,
    *,
    actor: User,
    status_filter: Optional[str] = None,
    priority_filter: Optional[str] = None,
    search: Optional[str] = None,
) -> List[Ticket]:
    query = db.query(Ticket)
    if actor.role == "customer":
        query = query.filter(Ticket.customer_id == actor.id)
    if status_filter:
        query = query.filter(Ticket.status == status_filter)
    if priority_filter:
        query = query.filter(Ticket.priority == priority_filter)
    if search:
        term = f"%{search.strip()}%"
        query = query.outerjoin(User, Ticket.customer_id == User.id).filter(
            or_(
                Ticket.id.ilike(term),
                Ticket.subject.ilike(term),
                Ticket.order_id.ilike(term),
                User.name.ilike(term),
                User.email.ilike(term),
            )
        )
    return query.order_by(Ticket.updated_at.desc()).all()


def get_ticket_authorized(db: Session, ticket_id: str, actor: User) -> Ticket:
    ticket = db.get(Ticket, ticket_id)
    if not ticket:
        raise AppError(status.HTTP_404_NOT_FOUND, "ticket_not_found", "Support ticket not found.")
    if actor.role == "customer" and ticket.customer_id != actor.id:
        raise AppError(status.HTTP_404_NOT_FOUND, "ticket_not_found", "Support ticket not found.")
    return ticket


def build_ticket_detail(db: Session, ticket: Ticket, actor: User) -> dict:
    customer = db.get(User, ticket.customer_id)
    order_resp = to_order_response(db, ticket.order) if ticket.order else None

    notes = []
    if actor.role in ("support_agent", "admin"):
        for n in ticket.internal_notes:
            author = db.get(User, n.author_id)
            notes.append(
                {
                    "id": n.id,
                    "ticket_id": n.ticket_id,
                    "author_id": n.author_id,
                    "author_name": author.name if author else "Staff",
                    "note": n.note,
                    "created_at": n.created_at,
                }
            )

    return {
        "id": ticket.id,
        "customer_id": ticket.customer_id,
        "customer_name": customer.name if customer else None,
        "customer_email": customer.email if customer else None,
        "order_id": ticket.order_id,
        "subject": ticket.subject,
        "description": ticket.description,
        "category": ticket.category,
        "status": ticket.status,
        "priority": ticket.priority,
        "created_at": ticket.created_at,
        "updated_at": ticket.updated_at,
        "order": order_resp,
        "messages": ticket.messages,
        "refunds": [
            {
                "id": r.id,
                "order_id": r.order_id,
                "ticket_id": r.ticket_id,
                "amount": r.amount,
                "reason": r.reason,
                "status": r.status,
                "idempotency_key": r.idempotency_key,
                "requested_by": r.requested_by,
                "reviewed_by": r.reviewed_by,
                "decision_note": r.decision_note,
                "created_at": r.created_at,
                "updated_at": r.updated_at,
            }
            for r in ticket.refunds
        ],
        "escalations": [
            {
                "id": e.id,
                "ticket_id": e.ticket_id,
                "refund_id": e.refund_id,
                "summary": e.summary,
                "reason_code": e.reason_code,
                "priority": e.priority,
                "assigned_to": e.assigned_to,
                "decision": e.decision,
                "internal_note": e.internal_note if actor.role in ("support_agent", "admin") else None,
                "created_at": e.created_at,
                "updated_at": e.updated_at,
            }
            for e in ticket.escalations
        ],
        "internal_notes": notes,
    }


def update_ticket_status(
    db: Session,
    *,
    ticket: Ticket,
    actor: User,
    new_status: Optional[str],
    new_priority: Optional[str],
) -> Ticket:
    changes = {}
    if new_status and new_status != ticket.status:
        changes["status"] = {"from": ticket.status, "to": new_status}
        ticket.status = new_status
    if new_priority and new_priority != ticket.priority:
        changes["priority"] = {"from": ticket.priority, "to": new_priority}
        ticket.priority = new_priority

    if changes:
        record_audit_event(
            db,
            actor_id=actor.id,
            actor_role=actor.role,
            action="ticket_updated",
            resource_type="ticket",
            resource_id=ticket.id,
            details=changes,
        )
        db.commit()
        db.refresh(ticket)
    return ticket


def add_internal_note(db: Session, *, ticket: Ticket, author: User, note_text: str) -> InternalNote:
    note = InternalNote(
        ticket_id=ticket.id,
        author_id=author.id,
        note=note_text.strip(),
    )
    db.add(note)
    record_audit_event(
        db,
        actor_id=author.id,
        actor_role=author.role,
        action="internal_note_added",
        resource_type="ticket",
        resource_id=ticket.id,
        details={"note_id": note.id},
    )
    db.commit()
    db.refresh(note)
    return note

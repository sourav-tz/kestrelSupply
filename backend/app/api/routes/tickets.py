from typing import List, Optional
from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.core.security import get_current_user, require_staff
from app.db.base import get_db
from app.db.models import Message, User
from app.schemas.ticket import (
    ChatMessageRequest,
    ChatTurnResponse,
    InternalNoteCreateRequest,
    InternalNoteResponse,
    MessageResponse,
    TicketCreateRequest,
    TicketDetailResponse,
    TicketResponse,
    TicketStatusUpdateRequest,
)
from app.services.agent_service import handle_customer_chat_turn, respond_to_existing_message
from app.services.ticket_service import (
    add_internal_note,
    build_ticket_detail,
    create_ticket,
    get_ticket_authorized,
    list_tickets,
    update_ticket_status,
)

router = APIRouter(prefix="/tickets", tags=["Tickets & Messages"])


@router.get("", response_model=List[TicketResponse])
def get_tickets(
    status_filter: Optional[str] = Query(default=None, alias="status"),
    priority: Optional[str] = Query(default=None),
    search: Optional[str] = Query(default=None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    tickets = list_tickets(
        db,
        actor=current_user,
        status_filter=status_filter,
        priority_filter=priority,
        search=search,
    )
    results = []
    for t in tickets:
        cust = db.get(User, t.customer_id)
        results.append(
            TicketResponse(
                id=t.id,
                customer_id=t.customer_id,
                customer_name=cust.name if cust else None,
                customer_email=cust.email if cust else None,
                order_id=t.order_id,
                subject=t.subject,
                description=t.description,
                category=t.category,
                status=t.status,
                priority=t.priority,
                created_at=t.created_at,
                updated_at=t.updated_at,
            )
        )
    return results


@router.post("", response_model=TicketDetailResponse, status_code=status.HTTP_201_CREATED)
def create_support_ticket(
    payload: TicketCreateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    ticket = create_ticket(
        db,
        customer=current_user,
        subject=payload.subject,
        description=payload.description,
        category=payload.category,
        priority=payload.priority,
        order_id=payload.order_id,
    )
    if payload.auto_reply and ticket.messages:
        respond_to_existing_message(
            db,
            ticket=ticket,
            customer=current_user,
            customer_msg=ticket.messages[0],
        )
        db.refresh(ticket)
    return TicketDetailResponse.model_validate(build_ticket_detail(db, ticket, current_user))


@router.get("/{ticket_id}", response_model=TicketDetailResponse)
def get_ticket_detail(
    ticket_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    ticket = get_ticket_authorized(db, ticket_id, current_user)
    return TicketDetailResponse.model_validate(build_ticket_detail(db, ticket, current_user))


@router.patch("/{ticket_id}/status", response_model=TicketResponse)
def patch_ticket_status(
    ticket_id: str,
    payload: TicketStatusUpdateRequest,
    staff_user: User = Depends(require_staff),
    db: Session = Depends(get_db),
):
    ticket = get_ticket_authorized(db, ticket_id, staff_user)
    updated = update_ticket_status(
        db,
        ticket=ticket,
        actor=staff_user,
        new_status=payload.status,
        new_priority=payload.priority,
    )
    cust = db.get(User, updated.customer_id)
    return TicketResponse(
        id=updated.id,
        customer_id=updated.customer_id,
        customer_name=cust.name if cust else None,
        customer_email=cust.email if cust else None,
        order_id=updated.order_id,
        subject=updated.subject,
        description=updated.description,
        category=updated.category,
        status=updated.status,
        priority=updated.priority,
        created_at=updated.created_at,
        updated_at=updated.updated_at,
    )


@router.get("/{ticket_id}/messages", response_model=List[MessageResponse])
def get_ticket_messages(
    ticket_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    ticket = get_ticket_authorized(db, ticket_id, current_user)
    return [MessageResponse.model_validate(m) for m in ticket.messages]


@router.post("/{ticket_id}/chat", response_model=ChatTurnResponse)
def post_chat_message(
    ticket_id: str,
    payload: ChatMessageRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    ticket = get_ticket_authorized(db, ticket_id, current_user)
    result = handle_customer_chat_turn(
        db,
        ticket=ticket,
        customer=current_user,
        content=payload.content,
        idempotency_key=payload.idempotency_key,
    )
    return ChatTurnResponse(
        customer_message=MessageResponse.model_validate(result["customer_message"]),
        agent_message=MessageResponse.model_validate(result["agent_message"]),
        ticket_status=result["ticket_status"],
        tools_executed=result["tools_executed"],
        guardrail_triggered=result["guardrail_triggered"],
        refund_created=result["refund_created"],
        escalation_created=result["escalation_created"],
    )


@router.post("/{ticket_id}/messages", response_model=MessageResponse, status_code=status.HTTP_201_CREATED)
def post_staff_reply(
    ticket_id: str,
    payload: ChatMessageRequest,
    staff_user: User = Depends(require_staff),
    db: Session = Depends(get_db),
):
    ticket = get_ticket_authorized(db, ticket_id, staff_user)
    msg = Message(
        ticket_id=ticket.id,
        sender_type="support_agent",
        sender_id=staff_user.id,
        content=payload.content.strip(),
        metadata_json={"staff_name": staff_user.name},
    )
    db.add(msg)
    if ticket.status == "escalated":
        ticket.status = "awaiting_customer"
    db.commit()
    db.refresh(msg)
    return MessageResponse.model_validate(msg)


@router.post("/{ticket_id}/notes", response_model=InternalNoteResponse, status_code=status.HTTP_201_CREATED)
def create_internal_note(
    ticket_id: str,
    payload: InternalNoteCreateRequest,
    staff_user: User = Depends(require_staff),
    db: Session = Depends(get_db),
):
    ticket = get_ticket_authorized(db, ticket_id, staff_user)
    note = add_internal_note(db, ticket=ticket, author=staff_user, note_text=payload.note)
    return InternalNoteResponse(
        id=note.id,
        ticket_id=note.ticket_id,
        author_id=note.author_id,
        author_name=staff_user.name,
        note=note.note,
        created_at=note.created_at,
    )

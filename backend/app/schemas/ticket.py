from datetime import datetime
from typing import Any, Dict, List, Literal, Optional
from pydantic import BaseModel, Field

from app.schemas.order import OrderResponse


class TicketCreateRequest(BaseModel):
    order_id: Optional[str] = Field(default=None, max_length=32)
    subject: str = Field(min_length=3, max_length=200)
    description: str = Field(min_length=5, max_length=4000)
    category: Literal[
        "Refund Request",
        "Damaged Item",
        "Delivery Issue",
        "Policy Inquiry",
        "Account & Billing",
        "Other",
    ] = "Refund Request"
    priority: Literal["low", "medium", "high", "urgent"] = "medium"


class TicketStatusUpdateRequest(BaseModel):
    status: Optional[Literal["open", "awaiting_customer", "escalated", "resolved", "closed"]] = None
    priority: Optional[Literal["low", "medium", "high", "urgent"]] = None


class MessageResponse(BaseModel):
    id: str
    ticket_id: str
    sender_type: str
    sender_id: Optional[str]
    content: str
    metadata_json: Dict[str, Any]
    created_at: datetime

    model_config = {"from_attributes": True}


class ChatMessageRequest(BaseModel):
    content: str = Field(min_length=1, max_length=4000)
    idempotency_key: Optional[str] = Field(default=None, max_length=128)


class ChatTurnResponse(BaseModel):
    customer_message: MessageResponse
    agent_message: MessageResponse
    ticket_status: str
    tools_executed: List[str]
    guardrail_triggered: Optional[str] = None
    refund_created: Optional[Dict[str, Any]] = None
    escalation_created: Optional[Dict[str, Any]] = None


class InternalNoteCreateRequest(BaseModel):
    note: str = Field(min_length=2, max_length=3000)


class InternalNoteResponse(BaseModel):
    id: str
    ticket_id: str
    author_id: str
    author_name: Optional[str] = None
    note: str
    created_at: datetime

    model_config = {"from_attributes": True}


class TicketResponse(BaseModel):
    id: str
    customer_id: str
    customer_name: Optional[str] = None
    customer_email: Optional[str] = None
    order_id: Optional[str]
    subject: str
    description: str
    category: str
    status: str
    priority: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class TicketDetailResponse(TicketResponse):
    order: Optional[OrderResponse] = None
    messages: List[MessageResponse] = []
    refunds: List[Dict[str, Any]] = []
    escalations: List[Dict[str, Any]] = []
    internal_notes: List[InternalNoteResponse] = []

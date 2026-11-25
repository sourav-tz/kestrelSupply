from datetime import datetime
from typing import Literal, Optional
from pydantic import BaseModel, Field


class RefundCreateRequest(BaseModel):
    order_id: str = Field(min_length=3, max_length=32)
    ticket_id: Optional[str] = Field(default=None, max_length=36)
    amount: Optional[float] = Field(default=None, gt=0)
    reason: str = Field(min_length=3, max_length=1000)
    idempotency_key: Optional[str] = Field(default=None, max_length=128)


class RefundDecisionRequest(BaseModel):
    decision: Literal["approved", "rejected"]
    decision_note: str = Field(min_length=3, max_length=1000)


class RefundResponse(BaseModel):
    id: str
    order_id: str
    ticket_id: str
    amount: float
    reason: str
    status: str
    idempotency_key: str
    requested_by: str
    reviewed_by: Optional[str]
    decision_note: Optional[str]
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class EscalationDecisionRequest(BaseModel):
    decision: Literal["approved", "rejected", "more_info_requested"]
    internal_note: str = Field(min_length=2, max_length=2000)
    customer_message: Optional[str] = Field(default=None, max_length=2000)


class EscalationResponse(BaseModel):
    id: str
    ticket_id: str
    refund_id: Optional[str]
    summary: str
    reason_code: str
    priority: str
    assigned_to: Optional[str]
    decision: str
    internal_note: Optional[str]
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class AuditLogResponse(BaseModel):
    id: str
    actor_id: Optional[str]
    actor_role: str
    action: str
    resource_type: str
    resource_id: str
    details_json: dict
    created_at: datetime

    model_config = {"from_attributes": True}

import json
import re
from typing import Any, Dict, List, Optional, Tuple
import uuid

import httpx
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.exceptions import AppError
from app.core.logging import get_logger
from app.db.models import Message, Ticket, User
from app.services.audit_service import record_audit_event
from app.services.escalation_service import escalate_to_human
from app.services.order_service import get_order_details
from app.services.policy_service import search_return_policy
from app.services.refund_service import process_refund

logger = get_logger("kestrel.agent")

_ORDER_ID_RE = re.compile(r"\b(ORD-[A-Z0-9]+)\b", re.IGNORECASE)
_AMOUNT_RE = re.compile(r"(?:₹|rs\.?|inr)\s*([0-9]+(?:,[0-9]{2,3})*(?:\.[0-9]{1,2})?)", re.IGNORECASE)

_INJECTION_PATTERNS = [
    re.compile(r"ignore\s+(?:all\s+)?(?:previous|prior|above)\s+instructions", re.IGNORECASE),
    re.compile(r"override\s+(?:all\s+)?(?:policy|policies|rules|limit|threshold|system)", re.IGNORECASE),
    re.compile(r"(?:bypass|skip|disable)\s+(?:policy|verification|return\s+window|limit|check|auth)", re.IGNORECASE),
    re.compile(r"reveal\s+(?:your\s+)?(?:system\s+prompt|instructions|secrets|other\s+customer)", re.IGNORECASE),
    re.compile(r"(?:act\s+as|pretend\s+to\s+be|you\s+are\s+now)\s+(?:admin|developer|root|system)", re.IGNORECASE),
    re.compile(r"jailbreak|developer\s+mode|sudo\s+approve|force\s+refund", re.IGNORECASE),
]

_REFUND_KEYWORDS = (
    "refund",
    "return",
    "money back",
    "reimburse",
    "damaged",
    "broken",
    "defective",
    "faulty",
    "wrong item",
    "cracked",
    "imbalance",
)
_ESCALATION_KEYWORDS = ("human", "specialist", "supervisor", "manager", "escalate", "real person")
_POLICY_KEYWORDS = ("policy", "window", "days", "rule", "eligible", "eligibility", "electronics", "apparel", "homeware", "beauty")
_ORDER_KEYWORDS = ("status", "delivery", "delivered", "track", "shipment", "details")
_EXPLICIT_REFUND_ACTION_RE = re.compile(
    r"\b(?:process|issue|give|request|want|need|get|initiate|submit)\b.{0,25}\b(?:refund|return|money\s+back)\b",
    re.IGNORECASE,
)


_GREETING_RE = re.compile(
    r"^\s*(?:hi+|hello+|hey+|hlo|namaste|hola|good\s+(?:morning|afternoon|evening)|thanks?|thank\s+you|ok(?:ay)?)[!.,?\s]*$",
    re.IGNORECASE,
)


def detect_prompt_injection(text: str) -> Optional[str]:
    for pattern in _INJECTION_PATTERNS:
        match = pattern.search(text)
        if match:
            return match.group(0)
    return None


def _is_pure_greeting(text: str) -> bool:
    return bool(_GREETING_RE.match(text))


def _extract_order_id(text: str, ticket: Ticket, history: List[Message]) -> Optional[str]:
    match = _ORDER_ID_RE.search(text)
    if match:
        return match.group(1).upper()
    if ticket.order_id:
        return ticket.order_id.upper()
    # Check multi-turn customer messages only (never match example IDs from AI replies)
    for msg in reversed(history):
        if msg.sender_type != "customer":
            continue
        hist_match = _ORDER_ID_RE.search(msg.content)
        if hist_match:
            return hist_match.group(1).upper()
    return None


def _extract_requested_amount(text: str) -> Optional[float]:
    match = _AMOUNT_RE.search(text)
    if not match:
        return None
    raw = match.group(1).replace(",", "")
    try:
        val = float(raw)
        return val if val > 0 else None
    except ValueError:
        return None


def _has_any_keyword(text: str, keywords: Tuple[str, ...]) -> bool:
    lowered = text.lower()
    return any(kw in lowered for kw in keywords)


def _infer_intent_from_history(current_text: str, ticket: Ticket, history: List[Message]) -> str:
    if _is_pure_greeting(current_text):
        return "general"
    if _has_any_keyword(current_text, _ESCALATION_KEYWORDS):
        return "escalate"
    # Policy questions (e.g. "What is the return policy for Electronics and Apparel?")
    # must route to RAG policy lookup unless the user explicitly asks to process/request a refund.
    if _has_any_keyword(current_text, ("policy", "rule", "window")) and not _EXPLICIT_REFUND_ACTION_RE.search(current_text):
        return "policy"
    if _has_any_keyword(current_text, _REFUND_KEYWORDS):
        return "refund"
    if _has_any_keyword(current_text, _POLICY_KEYWORDS):
        return "policy"
    if _has_any_keyword(current_text, _ORDER_KEYWORDS):
        return "order_status"

    # If user just replied with an Order ID (e.g., "ORD-1041"), inspect prior context
    if _ORDER_ID_RE.search(current_text):
        prior_text = " ".join(m.content for m in history if m.sender_type == "customer") + " " + ticket.description
        if ticket.category in ("Refund Request", "Damaged Item") or _has_any_keyword(prior_text, _REFUND_KEYWORDS):
            return "refund"
        return "order_status"

    return "general"


def _call_gemini_generate(
    system_prompt: str,
    user_prompt: str,
    *,
    temperature: float = 0.2,
    response_mime_type: Optional[str] = None,
) -> Optional[str]:
    settings = get_settings()
    base = (settings.LLM_BASE_URL or "https://generativelanguage.googleapis.com/v1beta").rstrip("/")
    model = settings.LLM_MODEL or "gemini-2.5-flash"
    if not base.endswith("v1beta") and not base.endswith("v1"):
        base = "https://generativelanguage.googleapis.com/v1beta"
    url = f"{base}/models/{model}:generateContent"

    generation_config: Dict[str, Any] = {"temperature": temperature}
    if response_mime_type:
        generation_config["responseMimeType"] = response_mime_type

    payload = {
        "systemInstruction": {"parts": [{"text": system_prompt}]},
        "contents": [{"role": "user", "parts": [{"text": user_prompt}]}],
        "generationConfig": generation_config,
    }
    try:
        with httpx.Client(timeout=12.0) as client:
            resp = client.post(
                url,
                headers={
                    "x-goog-api-key": settings.LLM_API_KEY,
                    "Content-Type": "application/json",
                },
                json=payload,
            )
            resp.raise_for_status()
            data = resp.json()
            candidates = data.get("candidates") or []
            if not candidates:
                return None
            parts = candidates[0].get("content", {}).get("parts") or []
            text = "".join(p.get("text", "") for p in parts).strip()
            return text or None
    except Exception as exc:
        logger.warning("gemini_api_fallback", extra={"reason": str(exc)})
        return None


def _classify_intent_with_gemini(
    current_text: str,
    ticket: Ticket,
    history: List[Message],
) -> Optional[Dict[str, Any]]:
    settings = get_settings()
    if settings.LLM_PROVIDER != "gemini" or not settings.LLM_API_KEY:
        return None

    recent_turns = "\n".join(
        f"{m.sender_type}: {m.content}" for m in history[-6:]
    )
    sys_prompt = (
        "Classify the customer's support message into one intent: "
        "'refund', 'order_status', 'policy', 'escalate', or 'general'. "
        "Return strict JSON with keys: intent (string), order_id (string or null), requested_amount (number or null)."
    )
    user_prompt = (
        f"Ticket category: {ticket.category} | Linked order: {ticket.order_id or 'None'}\n"
        f"Recent conversation:\n{recent_turns}\n\nLatest customer message: {current_text}"
    )
    raw = _call_gemini_generate(
        sys_prompt,
        user_prompt,
        temperature=0.0,
        response_mime_type="application/json",
    )
    if not raw:
        return None
    try:
        parsed = json.loads(raw)
        if parsed.get("intent") in ("refund", "order_status", "policy", "escalate", "general"):
            return parsed
    except Exception:
        return None
    return None


def _maybe_polish_with_external_llm(
    user_message: str,
    verified_facts: Dict[str, Any],
    fallback_response: str,
) -> Tuple[str, bool]:
    """
    Optional external LLM phrasing layer (Gemini or OpenAI-compatible).
    All tool execution, policy evaluation, and refund decisions are already finalized
    on the server before this runs; the LLM only formats verified facts if configured.
    """
    settings = get_settings()
    if not settings.LLM_API_KEY or settings.LLM_PROVIDER == "local_deterministic":
        return fallback_response, False

    system_prompt = (
        "You are Kestrel Supply's AI Support Specialist. Write a clear, concise, empathetic response "
        "using ONLY the verified server facts provided. Rules: plain text only (NO emojis, NO markdown bold/bullets unless needed), "
        "preserve exact Order IDs, Refund IDs, Escalation IDs, and ₹ amounts verbatim, and NEVER claim a refund was approved "
        "if the verified outcome is escalated_high_value, return_window_expired, duplicate_refund, order_not_delivered, "
        "order_not_accessible, missing_order_id, or guardrail_blocked."
    )
    user_prompt = (
        f"Customer message: {user_message}\n\n"
        f"Verified server outcome JSON:\n{json.dumps(verified_facts, default=str)}"
    )

    if settings.LLM_PROVIDER == "gemini":
        gemini_text = _call_gemini_generate(system_prompt, user_prompt, temperature=0.2)
        if gemini_text:
            return gemini_text, True
        return fallback_response, False

    if settings.LLM_PROVIDER != "openai_compatible":
        return fallback_response, False

    payload = {
        "model": settings.LLM_MODEL,
        "temperature": 0.2,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
    }
    try:
        with httpx.Client(timeout=8.0) as client:
            resp = client.post(
                f"{settings.LLM_BASE_URL.rstrip('/')}/chat/completions",
                headers={"Authorization": f"Bearer {settings.LLM_API_KEY}"},
                json=payload,
            )
            resp.raise_for_status()
            data = resp.json()
            text = data["choices"][0]["message"]["content"].strip()
            return (text, True) if text else (fallback_response, False)
    except Exception as exc:
        logger.warning("external_llm_fallback", extra={"reason": str(exc)})
        return fallback_response, False


def handle_customer_chat_turn(
    db: Session,
    *,
    ticket: Ticket,
    customer: User,
    content: str,
    idempotency_key: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Processes one multi-turn customer chat message on a ticket:
    1. Persists customer message.
    2. Delegates to _respond_to_message for guardrails, tool execution, and reply persistence.
    """
    history = (
        db.query(Message)
        .filter(Message.ticket_id == ticket.id)
        .order_by(Message.created_at.asc())
        .all()
    )

    customer_msg = Message(
        ticket_id=ticket.id,
        sender_type="customer",
        sender_id=customer.id,
        content=content.strip(),
        metadata_json={},
    )
    db.add(customer_msg)
    db.flush()

    return _respond_to_message(
        db,
        ticket=ticket,
        customer=customer,
        customer_msg=customer_msg,
        history=history,
        idempotency_key=idempotency_key,
    )


def respond_to_existing_message(
    db: Session,
    *,
    ticket: Ticket,
    customer: User,
    customer_msg: Message,
    idempotency_key: Optional[str] = None,
) -> Dict[str, Any]:
    """Generates and persists an AI agent reply for an already-persisted customer message."""
    history = (
        db.query(Message)
        .filter(Message.ticket_id == ticket.id, Message.id != customer_msg.id)
        .order_by(Message.created_at.asc())
        .all()
    )
    return _respond_to_message(
        db,
        ticket=ticket,
        customer=customer,
        customer_msg=customer_msg,
        history=history,
        idempotency_key=idempotency_key,
    )


def _respond_to_message(
    db: Session,
    *,
    ticket: Ticket,
    customer: User,
    customer_msg: Message,
    history: List[Message],
    idempotency_key: Optional[str] = None,
) -> Dict[str, Any]:
    content = customer_msg.content

    tools_executed: List[str] = []
    guardrail_triggered: Optional[str] = None
    refund_payload: Optional[Dict[str, Any]] = None
    escalation_payload: Optional[Dict[str, Any]] = None
    outcome = "informational"

    # 1. Prompt injection & policy override shield
    injection_hit = detect_prompt_injection(content)
    if injection_hit:
        guardrail_triggered = "prompt_injection_blocked"
        outcome = "guardrail_blocked"
        record_audit_event(
            db,
            actor_id=customer.id,
            actor_role=customer.role,
            action="prompt_injection_blocked",
            resource_type="ticket",
            resource_id=ticket.id,
            details={"matched_pattern": injection_hit},
        )
        reply_text = (
            "I cannot override Kestrel return policies, authorization checks, or the ₹5,000.00 automated "
            "refund threshold. I can still inspect an order that belongs to your account, explain category "
            "return windows, or submit an eligible refund or specialist escalation for review."
        )
        agent_msg = Message(
            ticket_id=ticket.id,
            sender_type="ai_agent",
            sender_id=None,
            content=reply_text,
            metadata_json={
                "tools_used": tools_executed,
                "guardrail_triggered": guardrail_triggered,
                "outcome": outcome,
            },
        )
        db.add(agent_msg)
        db.commit()
        db.refresh(customer_msg)
        db.refresh(agent_msg)
        return {
            "customer_message": customer_msg,
            "agent_message": agent_msg,
            "ticket_status": ticket.status,
            "tools_executed": tools_executed,
            "guardrail_triggered": guardrail_triggered,
            "refund_created": None,
            "escalation_created": None,
        }

    intent = _infer_intent_from_history(content, ticket, history)
    order_id = _extract_order_id(content, ticket, history)
    requested_amount = _extract_requested_amount(content)

    # Use Gemini NLU when deterministic keyword rules see a non-greeting generic turn
    if intent == "general" and not _is_pure_greeting(content):
        nlu = _classify_intent_with_gemini(content, ticket, history)
        if nlu:
            intent = nlu.get("intent", intent)
            if not order_id and isinstance(nlu.get("order_id"), str) and nlu["order_id"].upper().startswith("ORD-"):
                order_id = nlu["order_id"].upper()
            if requested_amount is None and isinstance(nlu.get("requested_amount"), (int, float)) and nlu["requested_amount"] > 0:
                requested_amount = float(nlu["requested_amount"])

    reply_text = ""
    customer_order_ids = [o.id for o in customer.orders]

    try:
        # 2. Explicit escalation request
        if intent == "escalate":
            esc = escalate_to_human(
                db,
                ticket_id=ticket.id,
                summary=f"Customer requested specialist review on ticket {ticket.id}: {content.strip()[:280]}",
                priority="high",
                reason_code="customer_requested_escalation",
                actor=customer,
            )
            tools_executed.append("escalate_to_human")
            outcome = "escalated"
            escalation_payload = {
                "id": esc.id,
                "ticket_id": esc.ticket_id,
                "priority": esc.priority,
                "decision": esc.decision,
            }
            reply_text = (
                f"I have escalated ticket {ticket.id} to a human support specialist (Escalation {esc.id}). "
                "Your conversation history and order context are attached for review."
            )

        # 3. Missing Order ID on order-dependent intent (ask before calling order/refund tools)
        elif intent in ("refund", "order_status") and not order_id:
            ticket.status = "awaiting_customer"
            outcome = "missing_order_id"
            if customer_order_ids:
                order_hint = f" (for example, {customer_order_ids[0]})"
                reply_text = (
                    f"Could you share the Order ID you need help with{order_hint}? "
                    "Once you provide the Order ID, I can verify delivery status, check the return policy window, "
                    "and process or escalate your request."
                )
            else:
                reply_text = (
                    "Could you share the Order ID you need help with? "
                    "I do not see any orders placed on this account yet, so if you have an Order ID, please reply with it and I will check."
                )

        # 4. Policy inquiry (works both standalone and inside an existing order-linked ticket)
        elif intent == "policy":
            search_query = content
            order_prefix = ""
            wants_order_context = bool(_ORDER_ID_RE.search(content)) or any(
                tok in content.lower() for tok in ("this item", "this order", "my order", "my item")
            )
            if order_id and wants_order_context:
                try:
                    order_info = get_order_details(db, order_id, customer)
                    tools_executed.append("get_order_details")
                    search_query = f"{order_info.category} {content}"
                    order_prefix = (
                        f"Order {order_info.id}: {order_info.item_name} ({order_info.category}) — "
                        f"Status: {order_info.status.upper()} | {order_info.eligibility.reason}\n\n"
                    )
                except AppError:
                    pass
            snippets = search_return_policy(search_query)
            tools_executed.append("search_return_policy")
            outcome = "policy_answered"
            if snippets:
                lines = [f"- {item['title']}: {item['content']}" for item in snippets]
                reply_text = order_prefix + "Here are the relevant Kestrel return and refund policy rules:\n" + "\n".join(lines)
            else:
                reply_text = order_prefix + (
                    "Kestrel offers 7 days for Electronics, 14 days for Apparel, 10 days for Homeware, and 2 days "
                    "for Beauty/Consumables (unopened or damaged on arrival). Refunds above ₹5,000.00 require specialist approval."
                )

        # 5. Order-scoped workflows (Order Status or Refund)
        elif intent in ("refund", "order_status") and order_id:
            try:
                order_info = get_order_details(db, order_id, customer)
                tools_executed.append("get_order_details")
                if not ticket.order_id:
                    ticket.order_id = order_info.id
            except AppError as err:
                outcome = err.code
                reply_text = (
                    f"I could not locate order {order_id} on your account. Please double-check the Order ID "
                    "in your Orders list and share the correct reference."
                )
                order_info = None

            if order_info is not None:
                policy_hits = search_return_policy(order_info.category)
                tools_executed.append("search_return_policy")
                policy_summary = policy_hits[0]["content"] if policy_hits else ""

                if intent == "refund":
                    idem_key = idempotency_key or f"chat-{ticket.id}-{order_info.id}-{uuid.uuid4().hex[:10]}"
                    try:
                        result = process_refund(
                            db,
                            actor=customer,
                            order_id=order_info.id,
                            ticket_id=ticket.id,
                            amount=requested_amount,
                            reason=content.strip(),
                            idempotency_key=idem_key,
                        )
                        if result.outcome == "escalated_high_value":
                            tools_executed.extend(["process_refund", "escalate_to_human"])
                            outcome = "escalated_high_value"
                            refund_payload = {
                                "id": result.refund.id,
                                "status": result.refund.status,
                                "amount": result.refund.amount,
                            }
                            if result.escalation:
                                escalation_payload = {
                                    "id": result.escalation.id,
                                    "decision": result.escalation.decision,
                                    "priority": result.escalation.priority,
                                }
                            reply_text = (
                                f"I verified order {order_info.id} ({order_info.item_name}, ₹{order_info.total_amount:,.2f}). "
                                f"It is within the {order_info.eligibility.return_window_days}-day {order_info.category} return window. "
                                f"Because the refund amount (₹{result.refund.amount:,.2f}) exceeds the ₹5,000.00 automated limit, "
                                f"I logged pending refund {result.refund.id} and escalated the case ({result.escalation.id if result.escalation else ''}) "
                                "to a support specialist for final approval."
                            )
                        else:
                            tools_executed.append("process_refund")
                            outcome = result.outcome
                            refund_payload = {
                                "id": result.refund.id,
                                "status": result.refund.status,
                                "amount": result.refund.amount,
                            }
                            reply_text = (
                                f"I verified order {order_info.id} ({order_info.item_name}) and checked the {order_info.category} "
                                f"return policy ({order_info.eligibility.return_window_days}-day window). "
                                f"Your refund of ₹{result.refund.amount:,.2f} has been approved and processed (Reference: {result.refund.id}). "
                                "Funds are credited back to your original payment method within 3-5 business days."
                            )
                    except AppError as ref_err:
                        outcome = ref_err.code
                        if ref_err.code == "return_window_expired":
                            reply_text = (
                                f"I checked order {order_info.id} ({order_info.item_name}, delivered "
                                f"{order_info.delivery_date.strftime('%d %b %Y') if order_info.delivery_date else 'earlier'}). "
                                f"Unfortunately, the {order_info.eligibility.return_window_days}-day {order_info.category} return window has expired "
                                f"({order_info.eligibility.days_since_delivery} days elapsed since delivery), so a refund cannot be processed under policy. "
                                "If you have special warranty or transit evidence, let me know and I can escalate this ticket to a specialist."
                            )
                        elif ref_err.code == "duplicate_refund":
                            reply_text = (
                                f"{ref_err.message} No duplicate refund transaction was created. "
                                "You can track the existing refund status directly in your Refunds ledger."
                            )
                        elif ref_err.code == "order_not_delivered":
                            reply_text = (
                                f"Order {order_info.id} is currently '{order_info.status}' and has not been delivered yet, "
                                "so a return refund cannot be initiated until delivery is completed."
                            )
                        else:
                            reply_text = ref_err.message
                else:
                    elig = order_info.eligibility
                    outcome = "order_status_reported"
                    delivered_str = (
                        order_info.delivery_date.strftime("%d %b %Y")
                        if order_info.delivery_date
                        else "Not yet delivered"
                    )
                    reply_text = (
                        f"Order {order_info.id}: {order_info.item_name} ({order_info.category}) — ₹{order_info.total_amount:,.2f}.\n"
                        f"Status: {order_info.status.upper()} | Delivery Date: {delivered_str}.\n"
                        f"Policy assessment: {elig.reason}"
                    )
                    if policy_summary:
                        reply_text += f"\nPolicy reference: {policy_summary}"

        else:
            # General conversation / greeting
            if _is_pure_greeting(content):
                outcome = "greeting"
                if customer_order_ids:
                    reply_text = (
                        f"Hello {customer.name}, welcome to Kestrel Support. How can I help you today? "
                        f"I can check your orders ({', '.join(customer_order_ids[:3])}), explain our return policy, "
                        "or help with a refund request."
                    )
                else:
                    reply_text = (
                        f"Hello {customer.name}, welcome to Kestrel Support. How can I help you today? "
                        "You can ask about our return and refund policies, share an Order ID, or connect with a specialist."
                    )
            else:
                snippets = search_return_policy(content)
                if snippets:
                    tools_executed.append("search_return_policy")
                outcome = "general_guidance"
                reply_text = (
                    "I can help inspect your orders, verify return eligibility, process eligible refunds up to ₹5,000.00, "
                    "or escalate complex issues to our support specialists. Share an Order ID or describe what you need help with."
                )

    except SQLAlchemyError as db_exc:
        db.rollback()
        logger.error("agent_database_failure", extra={"error": str(db_exc), "ticket_id": ticket.id})
        raise AppError(
            503,
            "service_temporarily_unavailable",
            "Our resolution service encountered a database error. No refund or state change was committed; please retry shortly.",
        ) from db_exc

    final_reply, used_external_llm = _maybe_polish_with_external_llm(
        content,
        {
            "outcome": outcome,
            "customer_name": customer.name,
            "customer_orders": customer_order_ids,
            "tools_executed": tools_executed,
            "refund": refund_payload,
            "escalation": escalation_payload,
            "draft_reply": reply_text,
        },
        reply_text,
    )

    settings = get_settings()
    agent_msg = Message(
        ticket_id=ticket.id,
        sender_type="ai_agent",
        sender_id=None,
        content=final_reply,
        metadata_json={
            "tools_used": tools_executed,
            "outcome": outcome,
            "guardrail_triggered": guardrail_triggered,
            "refund": refund_payload,
            "escalation": escalation_payload,
            "llm_provider": settings.LLM_PROVIDER if used_external_llm else "local_deterministic",
            "llm_model": settings.LLM_MODEL if used_external_llm else "deterministic",
        },
    )
    db.add(agent_msg)
    db.commit()
    db.refresh(customer_msg)
    db.refresh(agent_msg)
    db.refresh(ticket)

    return {
        "customer_message": customer_msg,
        "agent_message": agent_msg,
        "ticket_status": ticket.status,
        "tools_executed": tools_executed,
        "guardrail_triggered": guardrail_triggered,
        "refund_created": refund_payload,
        "escalation_created": escalation_payload,
    }

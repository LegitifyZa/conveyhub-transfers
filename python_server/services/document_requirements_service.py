"""DEEDLY Document Requirements Engine & Document Center Service.

This service manages the lifecycle of document requirements for conveyancing matters:
1. Evaluates Decision Tree rules against current matter facts (parties, properties, finance, classification).
2. Dynamically generates and updates the matter's requirements register (both automated and ad-hoc).
3. Supports manual ad-hoc document requests from conveyancers/attorneys.
4. Manages the requirement state machine (Required -> Awaiting Upload / Ready to Generate -> Under Review -> Satisfied / Rejected).
5. Provides readiness metrics and bundle completion status back to the outer matter workflow.
Strict tenant isolation (accountable_institution_id) is enforced on every operation.
"""

from datetime import datetime, timezone
import json
from typing import Any, Dict, List, Optional
from uuid import UUID

import asyncpg

import db


class DocumentRequirementServiceError(Exception):
    """Base exception for document requirement service errors."""
    pass


class RequirementNotFoundError(DocumentRequirementServiceError):
    """Raised when a requested requirement is not found or tenant mismatched."""
    pass


class MatterNotFoundError(DocumentRequirementServiceError):
    """Raised when the specified matter is not found or tenant mismatched."""
    pass


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _eval_condition(condition: Dict[str, Any], facts: Dict[str, Any]) -> bool:
    """Evaluates a JSON condition expression against a facts dictionary.
    
    Supports:
    - Direct equality: {"classification_category": "transfer"}
    - "and": [{"op": ...}, ...]
    - "or": [{"op": ...}, ...]
    - "eq", "in", "neq"
    """
    if not condition:
        return True

    if "and" in condition:
        return all(_eval_condition(sub, facts) for sub in condition["and"])

    if "or" in condition:
        return any(_eval_condition(sub, facts) for sub in condition["or"])

    for key, expected in condition.items():
        if key in ("and", "or"):
            continue
        actual = facts.get(key)
        if isinstance(expected, dict) and "op" in expected:
            op = expected["op"]
            val = expected.get("value")
            if op == "eq" and actual != val:
                return False
            elif op == "neq" and actual == val:
                return False
            elif op == "in" and (actual not in (val or [])):
                return False
        else:
            if actual != expected:
                return False

    return True


async def evaluate_matter_requirements(
    accountable_institution_id: int,
    matter_id: UUID,
    conn: Optional[asyncpg.Connection] = None
) -> List[Dict[str, Any]]:
    """Evaluates decision tree rules against current matter facts and synchronizes

    the matter's active requirements register in transfers.matter_document_requirements.
    """
    async def _evaluate(c: asyncpg.Connection) -> List[Dict[str, Any]]:
        # 1. Verify matter existence and tenant isolation
        matter_row = await c.fetchrow(
            """
            SELECT m.id, m.matter_type, m.classification_code, m.accountable_institution_id,
                   mco.category AS classification_category, mco.subtype AS classification_subtype
            FROM transfers.matters m
            LEFT JOIN transfers.matter_classification_options mco 
                   ON mco.canonical_code = m.classification_code
            WHERE m.id = $1 AND m.accountable_institution_id = $2
            """,
            matter_id, accountable_institution_id
        )
        if not matter_row:
            raise MatterNotFoundError(f"Matter {matter_id} not found for institution {accountable_institution_id}")

        classification_category = matter_row["classification_category"] or "transfer"
        classification_subtype = matter_row["classification_subtype"] or "private_treaty"

        # 2. Collect property facts
        properties = await c.fetch(
            """
            SELECT p.id, p.property_type, p.sectional_scheme_name, p.erf_number
            FROM transfers.properties p
            JOIN transfers.transfers t ON t.id = p.created_for_transfer_id
            WHERE t.matter_id = $1 AND p.accountable_institution_id = $2
            """,
            matter_id, accountable_institution_id
        )

        has_sectional_title = any(
            (p.get("property_type") or "").lower() in ("sectional_title", "sectional title")
            for p in properties
        )

        # 3. Collect party facts
        parties = await c.fetch(
            """
            SELECT p.id, p.role, p.entity_type, p.display_name, p.id_number
            FROM transfers.parties p
            WHERE p.matter_id = $1 AND p.accountable_institution_id = $2
            """,
            matter_id, accountable_institution_id
        )

        # 4. Fetch all active requirement rules and document definitions
        rules = await c.fetch(
            """
            SELECT r.rule_code, r.document_code, r.title, r.target_role_code,
                   r.condition_expression, r.requirement_nature, r.priority,
                   d.name AS doc_name, d.fulfillment_type, d.category AS doc_category
            FROM transfers.document_requirement_rules r
            JOIN transfers.document_definitions d ON d.code = r.document_code
            WHERE r.is_active = TRUE AND d.is_active = TRUE
            ORDER BY r.priority ASC
            """
        )

        # 5. Determine which requirements apply based on facts
        # Each candidate is: (rule_code, document_code, target_party_id, title, instructions, fulfillment_type)
        candidate_requirements = []

        for rule in rules:
            rule_code = rule["rule_code"]
            doc_code = rule["document_code"]
            target_role = rule["target_role_code"]
            cond = rule["condition_expression"]
            if isinstance(cond, str):
                cond = json.loads(cond)
            fulfillment_type = rule["fulfillment_type"]

            # If rule targets a specific party role, evaluate per party matching that role
            if target_role:
                matching_parties = [p for p in parties if p.get("role") == target_role]
                for p in matching_parties:
                    party_facts = {
                        "classification_code": matter_row["classification_code"],
                        "classification_category": classification_category,
                        "classification_subtype": classification_subtype,
                        "property_type": "sectional_title" if has_sectional_title else "freehold",
                        "entity_type": p.get("entity_type") or "person",
                        "party_role": p.get("role"),
                    }
                    if _eval_condition(cond, party_facts):
                        party_title = f"{rule['doc_name']} — {p.get('display_name') or 'Party'}"
                        candidate_requirements.append({
                            "rule_code": rule_code,
                            "document_code": doc_code,
                            "target_party_id": p["id"],
                            "title": party_title,
                            "fulfillment_type": fulfillment_type,
                        })
            elif "entity_type" in cond:
                # Rule applies to any party with matching entity type (e.g. FICA rules)
                for p in parties:
                    party_facts = {
                        "classification_code": matter_row["classification_code"],
                        "classification_category": classification_category,
                        "classification_subtype": classification_subtype,
                        "property_type": "sectional_title" if has_sectional_title else "freehold",
                        "entity_type": p.get("entity_type") or "person",
                        "party_role": p.get("role"),
                    }
                    if _eval_condition(cond, party_facts):
                        role_label = f" ({p.get('role').title()})" if p.get("role") else ""
                        party_title = f"{rule['doc_name']} — {p.get('display_name') or 'Party'}{role_label}"
                        candidate_requirements.append({
                            "rule_code": rule_code,
                            "document_code": doc_code,
                            "target_party_id": p["id"],
                            "title": party_title,
                            "fulfillment_type": fulfillment_type,
                        })
            else:
                # Matter-level requirement
                matter_facts = {
                    "classification_code": matter_row["classification_code"],
                    "classification_category": classification_category,
                    "classification_subtype": classification_subtype,
                    "property_type": "sectional_title" if has_sectional_title else "freehold",
                }
                if _eval_condition(cond, matter_facts):
                    candidate_requirements.append({
                        "rule_code": rule_code,
                        "document_code": doc_code,
                        "target_party_id": None,
                        "title": rule["title"] or rule["doc_name"],
                        "fulfillment_type": fulfillment_type,
                    })

        # 6. Fetch existing automated requirements for this matter
        existing_rows = await c.fetch(
            """
            SELECT id, document_code, rule_code, target_party_id, status, satisfaction_source
            FROM transfers.matter_document_requirements
            WHERE matter_id = $1 AND accountable_institution_id = $2 AND origin = 'RULE_AUTOMATED'
            """,
            matter_id, accountable_institution_id
        )

        existing_map = {}
        for r in existing_rows:
            key = (r["document_code"], r["target_party_id"])
            existing_map[key] = r

        matched_keys = set()

        for cand in candidate_requirements:
            key = (cand["document_code"], cand["target_party_id"])
            matched_keys.add(key)
            existing = existing_map.get(key)

            if not existing:
                # New requirement: insert into register
                init_status = "READY_TO_GENERATE" if cand["fulfillment_type"] == "GENERATED" else "AWAITING_UPLOAD"
                new_row = await c.fetchrow(
                    """
                    INSERT INTO transfers.matter_document_requirements (
                        accountable_institution_id, matter_id, document_code, rule_code,
                        origin, target_party_id, title, status, created_at, updated_at
                    ) VALUES ($1, $2, $3, $4, 'RULE_AUTOMATED', $5, $6, $7, $8, $8)
                    RETURNING id
                    """,
                    accountable_institution_id, matter_id, cand["document_code"], cand["rule_code"],
                    cand["target_party_id"], cand["title"], init_status, _now()
                )
                # Record audit history
                await c.execute(
                    """
                    INSERT INTO transfers.matter_document_requirement_history (
                        requirement_id, matter_id, accountable_institution_id,
                        previous_status, new_status, change_reason, metadata
                    ) VALUES ($1, $2, $3, NULL, $4, 'Automated rule evaluation activated requirement', $5)
                    """,
                    new_row["id"], matter_id, accountable_institution_id, init_status,
                    json.dumps({"rule_code": cand["rule_code"]})
                )
            elif existing["status"] in ("NOT_APPLICABLE", "SUPERSEDED"):
                # Reactivate if conditions became true again
                re_status = "READY_TO_GENERATE" if cand["fulfillment_type"] == "GENERATED" else "AWAITING_UPLOAD"
                await c.execute(
                    """
                    UPDATE transfers.matter_document_requirements
                    SET status = $1, rule_code = $2, updated_at = $3
                    WHERE id = $4 AND accountable_institution_id = $5
                    """,
                    re_status, cand["rule_code"], _now(), existing["id"], accountable_institution_id
                )
                await c.execute(
                    """
                    INSERT INTO transfers.matter_document_requirement_history (
                        requirement_id, matter_id, accountable_institution_id,
                        previous_status, new_status, change_reason
                    ) VALUES ($1, $2, $3, $4, $5, 'Re-activated by rule evaluation')
                    """,
                    existing["id"], matter_id, accountable_institution_id, existing["status"], re_status
                )

        # 7. Any automated requirements that are no longer matched become NOT_APPLICABLE
        for key, existing in existing_map.items():
            if key not in matched_keys and existing["status"] not in ("SATISFIED", "NOT_APPLICABLE", "SUPERSEDED"):
                await c.execute(
                    """
                    UPDATE transfers.matter_document_requirements
                    SET status = 'NOT_APPLICABLE', updated_at = $1
                    WHERE id = $2 AND accountable_institution_id = $3
                    """,
                    _now(), existing["id"], accountable_institution_id
                )
                await c.execute(
                    """
                    INSERT INTO transfers.matter_document_requirement_history (
                        requirement_id, matter_id, accountable_institution_id,
                        previous_status, new_status, change_reason
                    ) VALUES ($1, $2, $3, $4, 'NOT_APPLICABLE', 'Matter condition no longer applies')
                    """,
                    existing["id"], matter_id, accountable_institution_id, existing["status"]
                )

        return await get_matter_requirements(accountable_institution_id, matter_id, c)

    if conn is not None:
        return await _evaluate(conn)
    return await db.with_transaction(_evaluate)


async def request_adhoc_document(
    accountable_institution_id: int,
    matter_id: UUID,
    document_code: str,
    title: str,
    instructions: Optional[str] = None,
    target_party_id: Optional[UUID] = None,
    created_by_user_id: Optional[UUID] = None,
    conn: Optional[asyncpg.Connection] = None
) -> Dict[str, Any]:
    """Allows an attorney/conveyancer to manually request an ad-hoc or additional document."""
    async def _request(c: asyncpg.Connection) -> Dict[str, Any]:
        # 1. Verify matter existence
        matter = await c.fetchrow(
            "SELECT id FROM transfers.matters WHERE id = $1 AND accountable_institution_id = $2",
            matter_id, accountable_institution_id
        )
        if not matter:
            raise MatterNotFoundError(f"Matter {matter_id} not found for institution {accountable_institution_id}")

        # 2. Verify document definition
        doc_def = await c.fetchrow(
            "SELECT code, name, fulfillment_type FROM transfers.document_definitions WHERE code = $1",
            document_code
        )
        fulfillment_type = doc_def["fulfillment_type"] if doc_def else "COLLECTED"
        init_status = "READY_TO_GENERATE" if fulfillment_type == "GENERATED" else "AWAITING_UPLOAD"

        row = await c.fetchrow(
            """
            INSERT INTO transfers.matter_document_requirements (
                accountable_institution_id, matter_id, document_code, origin,
                target_party_id, title, instructions, status, created_by_user_id,
                created_at, updated_at
            ) VALUES ($1, $2, $3, 'MANUAL_AD_HOC', $4, $5, $6, $7, $8, $9, $9)
            RETURNING id, matter_id, document_code, origin, title, status, created_at
            """,
            accountable_institution_id, matter_id, document_code, target_party_id,
            title, instructions, init_status, created_by_user_id, _now()
        )

        await c.execute(
            """
            INSERT INTO transfers.matter_document_requirement_history (
                requirement_id, matter_id, accountable_institution_id,
                previous_status, new_status, change_reason, actor_user_id
            ) VALUES ($1, $2, $3, NULL, $4, 'Conveyancer manually requested additional document', $5)
            """,
            row["id"], matter_id, accountable_institution_id, init_status, created_by_user_id
        )

        return dict(row)

    if conn is not None:
        return await _request(conn)
    return await db.with_transaction(_request)


async def record_document_upload(
    accountable_institution_id: int,
    requirement_id: UUID,
    transfer_document_id: UUID,
    uploaded_by_user_id: Optional[UUID] = None,
    conn: Optional[asyncpg.Connection] = None
) -> Dict[str, Any]:
    """Records that a client or attorney uploaded an artifact for a requirement."""
    async def _upload(c: asyncpg.Connection) -> Dict[str, Any]:
        existing = await c.fetchrow(
            """
            SELECT id, matter_id, status FROM transfers.matter_document_requirements
            WHERE id = $1 AND accountable_institution_id = $2
            """,
            requirement_id, accountable_institution_id
        )
        if not existing:
            raise RequirementNotFoundError(f"Requirement {requirement_id} not found")

        prev_status = existing["status"]
        new_status = "UNDER_REVIEW"

        await c.execute(
            """
            UPDATE transfers.matter_document_requirements
            SET status = $1, satisfied_by_document_id = $2, satisfaction_source = 'UPLOADED', updated_at = $3
            WHERE id = $4 AND accountable_institution_id = $5
            """,
            new_status, transfer_document_id, _now(), requirement_id, accountable_institution_id
        )

        await c.execute(
            """
            INSERT INTO transfers.matter_document_requirement_history (
                requirement_id, matter_id, accountable_institution_id,
                previous_status, new_status, change_reason, actor_user_id, metadata
            ) VALUES ($1, $2, $3, $4, $5, 'Client/User uploaded document artifact', $6, $7)
            """,
            requirement_id, existing["matter_id"], accountable_institution_id,
            prev_status, new_status, uploaded_by_user_id,
            json.dumps({"transfer_document_id": str(transfer_document_id)})
        )

        return {"requirement_id": requirement_id, "status": new_status, "document_id": transfer_document_id}

    if conn is not None:
        return await _upload(conn)
    return await db.with_transaction(_upload)


async def review_document_requirement(
    accountable_institution_id: int,
    requirement_id: UUID,
    approved: bool,
    reviewer_user_id: Optional[UUID] = None,
    rejection_reason: Optional[str] = None,
    conn: Optional[asyncpg.Connection] = None
) -> Dict[str, Any]:
    """Approves (satisfies) or rejects an uploaded document requirement."""
    async def _review(c: asyncpg.Connection) -> Dict[str, Any]:
        existing = await c.fetchrow(
            """
            SELECT id, matter_id, status FROM transfers.matter_document_requirements
            WHERE id = $1 AND accountable_institution_id = $2
            """,
            requirement_id, accountable_institution_id
        )
        if not existing:
            raise RequirementNotFoundError(f"Requirement {requirement_id} not found")

        prev_status = existing["status"]
        new_status = "SATISFIED" if approved else "REJECTED"

        await c.execute(
            """
            UPDATE transfers.matter_document_requirements
            SET status = $1, rejection_reason = $2, reviewed_by_user_id = $3,
                reviewed_at = $4, updated_at = $4
            WHERE id = $5 AND accountable_institution_id = $6
            """,
            new_status, rejection_reason if not approved else None,
            reviewer_user_id, _now(), requirement_id, accountable_institution_id
        )

        await c.execute(
            """
            INSERT INTO transfers.matter_document_requirement_history (
                requirement_id, matter_id, accountable_institution_id,
                previous_status, new_status, change_reason, actor_user_id, metadata
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            """,
            requirement_id, existing["matter_id"], accountable_institution_id,
            prev_status, new_status,
            "Approved by conveyancer" if approved else f"Rejected: {rejection_reason}",
            reviewer_user_id,
            json.dumps({"rejection_reason": rejection_reason} if rejection_reason else {})
        )

        return {
            "requirement_id": requirement_id,
            "status": new_status,
            "approved": approved,
            "rejection_reason": rejection_reason
        }

    if conn is not None:
        return await _review(conn)
    return await db.with_transaction(_review)


async def mark_generation_satisfied(
    accountable_institution_id: int,
    requirement_id: UUID,
    generation_id: str,
    conn: Optional[asyncpg.Connection] = None
) -> Dict[str, Any]:
    """Marks a generated document requirement as SATISFIED with its generation ID."""
    async def _satisfy(c: asyncpg.Connection) -> Dict[str, Any]:
        existing = await c.fetchrow(
            """
            SELECT id, matter_id, status FROM transfers.matter_document_requirements
            WHERE id = $1 AND accountable_institution_id = $2
            """,
            requirement_id, accountable_institution_id
        )
        if not existing:
            raise RequirementNotFoundError(f"Requirement {requirement_id} not found")

        prev_status = existing["status"]
        new_status = "SATISFIED"

        await c.execute(
            """
            UPDATE transfers.matter_document_requirements
            SET status = $1, satisfied_by_generation_id = $2,
                satisfaction_source = 'GENERATED', updated_at = $3
            WHERE id = $4 AND accountable_institution_id = $5
            """,
            new_status, generation_id, _now(), requirement_id, accountable_institution_id
        )

        await c.execute(
            """
            INSERT INTO transfers.matter_document_requirement_history (
                requirement_id, matter_id, accountable_institution_id,
                previous_status, new_status, change_reason, metadata
            ) VALUES ($1, $2, $3, $4, $5, 'Generated document produced and linked', $6)
            """,
            requirement_id, existing["matter_id"], accountable_institution_id,
            prev_status, new_status, json.dumps({"generation_id": generation_id})
        )

        return {"requirement_id": requirement_id, "status": new_status, "generation_id": generation_id}

    if conn is not None:
        return await _satisfy(conn)
    return await db.with_transaction(_satisfy)


async def record_document_download(
    accountable_institution_id: int,
    requirement_id: UUID,
    user_id: Optional[int] = None,
    conn: Optional[asyncpg.Connection] = None
) -> Dict[str, Any]:
    """Authorizes document download, asserts tenant isolation, and writes an audit log."""
    async def _download(c: asyncpg.Connection) -> Dict[str, Any]:
        existing = await c.fetchrow(
            """
            SELECT r.id, r.matter_id, r.document_code, r.status,
                   r.satisfied_by_document_id, r.satisfied_by_generation_id,
                   d.name AS document_name, td.file_path, td.file_type
            FROM transfers.matter_document_requirements r
            JOIN transfers.document_definitions d ON d.code = r.document_code
            LEFT JOIN transfers.transfer_documents td ON td.id = r.satisfied_by_document_id
            WHERE r.id = $1 AND r.accountable_institution_id = $2
            """,
            requirement_id, accountable_institution_id
        )
        if not existing:
            raise RequirementNotFoundError(f"Requirement {requirement_id} not found")

        await c.execute(
            """
            INSERT INTO transfers.matter_document_requirement_history (
                requirement_id, matter_id, accountable_institution_id,
                previous_status, new_status, change_reason, metadata
            ) VALUES ($1, $2, $3, $4, $4, 'Authorized download of document artifact', $5)
            """,
            requirement_id, existing["matter_id"], accountable_institution_id,
            existing["status"],
            json.dumps({"downloaded_by_user_id": user_id, "document_name": existing["document_name"]})
        )

        return {
            "requirement_id": requirement_id,
            "document_name": existing["document_name"],
            "file_path": existing["file_path"],
            "file_type": existing["file_type"],
            "generation_id": existing["satisfied_by_generation_id"]
        }

    if conn is not None:
        return await _download(conn)
    return await db.with_transaction(_download)


async def get_matter_requirements(
    accountable_institution_id: int,
    matter_id: UUID,
    conn: Optional[asyncpg.Connection] = None
) -> List[Dict[str, Any]]:
    """Retrieves all active requirements for a matter with document and party context."""
    query_str = """
        SELECT r.id, r.matter_id, r.document_code, r.rule_code, r.origin,
               r.target_party_id, r.title, r.instructions, r.status,
               r.satisfaction_source, r.satisfied_by_generation_id,
               r.satisfied_by_document_id, r.rejection_reason,
               r.created_at, r.updated_at,
               d.name AS document_name, d.category AS document_category,
               d.fulfillment_type, d.default_output_formats,
               p.display_name AS party_name, p.role AS party_role
        FROM transfers.matter_document_requirements r
        JOIN transfers.document_definitions d ON d.code = r.document_code
        LEFT JOIN transfers.parties p ON p.id = r.target_party_id
        WHERE r.matter_id = $1 AND r.accountable_institution_id = $2
          AND r.status NOT IN ('NOT_APPLICABLE', 'SUPERSEDED')
        ORDER BY d.category ASC, r.created_at ASC
    """
    if conn is not None:
        rows = await conn.fetch(query_str, matter_id, accountable_institution_id)
    else:
        res = await db.query(query_str, [matter_id, accountable_institution_id])
        rows = res.rows

    return [dict(row) for row in rows]


async def get_matter_requirements_summary(
    accountable_institution_id: int,
    matter_id: UUID,
    conn: Optional[asyncpg.Connection] = None
) -> Dict[str, Any]:
    """Returns aggregated document readiness metrics for the outer matter system."""
    reqs = await get_matter_requirements(accountable_institution_id, matter_id, conn)

    total_count = len(reqs)
    satisfied_count = sum(1 for r in reqs if r["status"] == "SATISFIED")
    pending_upload_count = sum(1 for r in reqs if r["status"] == "AWAITING_UPLOAD")
    under_review_count = sum(1 for r in reqs if r["status"] == "UNDER_REVIEW")
    ready_to_generate_count = sum(1 for r in reqs if r["status"] == "READY_TO_GENERATE")
    rejected_count = sum(1 for r in reqs if r["status"] == "REJECTED")

    # Category completion checks
    fica_reqs = [r for r in reqs if r.get("document_category") == "fica"]
    fica_complete = len(fica_reqs) > 0 and all(r["status"] == "SATISFIED" for r in fica_reqs)

    rates_reqs = [r for r in reqs if r.get("document_category") == "municipal_rates"]
    rates_complete = len(rates_reqs) > 0 and all(r["status"] == "SATISFIED" for r in rates_reqs)

    progress_percent = round((satisfied_count / total_count * 100)) if total_count > 0 else 100

    return {
        "matter_id": matter_id,
        "total_required": total_count,
        "satisfied": satisfied_count,
        "pending_upload": pending_upload_count,
        "under_review": under_review_count,
        "ready_to_generate": ready_to_generate_count,
        "rejected": rejected_count,
        "progress_percent": progress_percent,
        "bundles": {
            "fica_complete": fica_complete,
            "rates_clearance_complete": rates_complete,
            "all_satisfied": satisfied_count == total_count and total_count > 0
        },
        "requirements": reqs
    }

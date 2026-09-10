"""Local lifecycle service for SARS submission snapshots and events.

No outbound SARS integration is performed. The service manages draft snapshots,
local status transitions, and append-only event history.
"""

from typing import Any, Dict, Optional, Union
from uuid import UUID

import db
import repositories.sars as sars_repository
from services.sars_submission_payload_builder import build_payload


class SarsSubmissionLifecycleServiceError(Exception):
    """Raised for lifecycle-level failures."""

    pass


async def _with_transaction(callback, connection: Any = None):
    if connection is not None:
        return await callback(connection)

    async def _do(connection: Any):
        return await callback(connection)

    return await db.with_transaction(_do)


async def create_or_refresh_draft(
    transfer_id: Union[UUID, str],
    *,
    actor_user_id: Optional[int] = None,
    connection: Any = None,
) -> Dict[str, Any]:
    """Create a new draft submission, or refresh the payload of an existing draft."""

    async def _do(conn: Any) -> Dict[str, Any]:
        existing = await sars_repository.get_active_draft_submission(transfer_id, connection=conn)

        if existing:
            payload = await build_payload(transfer_id, submission_id=existing["id"], connection=conn)
            updated = await sars_repository.update_submission_payload(
                existing["id"],
                submission_payload=payload,
                actor_user_id=actor_user_id,
                connection=conn,
            )
            return _enrich_submission(updated)

        payload = await build_payload(transfer_id, connection=conn)
        submission = await sars_repository.create_sars_submission(
            transfer_id,
            submission_payload=payload,
            actor_user_id=actor_user_id,
            connection=conn,
        )
        await sars_repository.create_sars_submission_event(
            submission["id"],
            event_type="created",
            payload={"source": "create_or_refresh_draft"},
            actor_user_id=actor_user_id,
            connection=conn,
        )
        return _enrich_submission(submission)

    return await _with_transaction(_do, connection=connection)


async def record_local_submission(
    submission_id: Union[UUID, str],
    *,
    actor_user_id: Optional[int] = None,
    connection: Any = None,
) -> Dict[str, Any]:
    """Move the draft to ``submitted`` and append a submission event (local only)."""

    async def _do(conn: Any) -> Dict[str, Any]:
        submission = await sars_repository.transition_submission_status(
            submission_id,
            new_status="submitted",
            actor_user_id=actor_user_id,
            connection=conn,
        )
        await sars_repository.create_sars_submission_event(
            submission_id,
            event_type="submitted",
            payload={"source": "record_local_submission"},
            actor_user_id=actor_user_id,
            connection=conn,
        )
        return _enrich_submission(submission)

    return await _with_transaction(_do, connection=connection)


async def record_response(
    submission_id: Union[UUID, str],
    *,
    response_payload: Optional[Dict[str, Any]] = None,
    actor_user_id: Optional[int] = None,
    connection: Any = None,
) -> Dict[str, Any]:
    """Record an upstream SARS response event without network side effects."""

    async def _do(conn: Any) -> Dict[str, Any]:
        event = await sars_repository.create_sars_submission_event(
            submission_id,
            event_type="response_received",
            payload=response_payload or {},
            actor_user_id=actor_user_id,
            connection=conn,
        )
        return dict(event)

    return await _with_transaction(_do, connection=connection)


def _enrich_submission(submission: Dict[str, Any]) -> Dict[str, Any]:
    submission = dict(submission)
    if submission.get("submission_payload"):
        # Keep the JSONB payload as a dict for callers.
        if isinstance(submission["submission_payload"], str):
            import json

            submission["submission_payload"] = json.loads(submission["submission_payload"])
    return submission

"""Record SARS declaration events and refresh the parent submission payload."""

from typing import Any, Dict, Optional, Union
from uuid import UUID

import db
import repositories.sars as sars_repository
from services.sars_submission_payload_builder import build_payload
from services.sars_submission_lifecycle_service import _with_transaction


class SarsDeclarationServiceError(Exception):
    """Raised for declaration validation failures."""

    pass


VALID_DECLARATION_TYPES = {"seller", "purchaser", "conveyancer", "additional_conveyancer"}


async def record_declaration(
    submission_id: Union[UUID, str],
    *,
    declaration_type: str,
    declared_by_party_id: Optional[Union[UUID, str]] = None,
    declared_by_user_id: Optional[int] = None,
    declaration_date: Optional[str] = None,
    signature_document_id: Optional[Union[UUID, str]] = None,
    actor_user_id: Optional[int] = None,
    connection: Any = None,
) -> Dict[str, Any]:
    """Persist a declaration event and update the submission snapshot.

    ``signature_document_id`` is a reference to an existing
    ``transfer_documents`` row; raw signature data is never stored here.
    """
    if declaration_type not in VALID_DECLARATION_TYPES:
        raise SarsDeclarationServiceError(f"Invalid declaration_type: {declaration_type}")

    async def _do(conn: Any) -> Dict[str, Any]:
        submission = await sars_repository.get_sars_submission(submission_id, connection=conn)
        if not submission:
            raise SarsDeclarationServiceError("Submission not found")

        # Increment version per declaration type.
        existing = await sars_repository.list_sars_declaration_events(submission_id, connection=conn)
        version = 1 + sum(1 for e in existing if e.get("declaration_type") == declaration_type)

        declaration = await sars_repository.create_sars_declaration_event(
            submission_id,
            declaration_type=declaration_type,
            declared_by_party_id=declared_by_party_id,
            declared_by_user_id=declared_by_user_id,
            declaration_date=declaration_date,
            signature_document_id=signature_document_id,
            version=version,
            actor_user_id=actor_user_id,
            connection=conn,
        )

        # Refresh the immutable payload snapshot with the new declaration.
        payload = await build_payload(
            submission["transfer_id"],
            submission_id=submission_id,
            connection=conn,
        )
        await sars_repository.update_submission_payload(
            submission_id,
            submission_payload=payload,
            actor_user_id=actor_user_id,
            connection=conn,
        )

        return dict(declaration)

    return await _with_transaction(_do, connection=connection)

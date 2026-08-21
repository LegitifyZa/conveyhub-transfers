import uuid
from dataclasses import dataclass
from typing import List, Optional


@dataclass(frozen=True)
class CurrentUser:
    user_id: int
    golden_record_id: Optional[uuid.UUID]
    abilities: List[str]
    accountable_institution_id: int
    user_roles_id: int
    tenant_id: Optional[uuid.UUID]

    def has_ability(self, ability: str) -> bool:
        return ability in self.abilities

    def is_role(self, *roles: int) -> bool:
        return self.user_roles_id in roles

    @property
    def is_super_admin(self) -> bool:
        return self.user_roles_id == 1

    @property
    def is_client(self) -> bool:
        return self.user_roles_id == 4

    @property
    def is_agent_or_above(self) -> bool:
        return self.user_roles_id in (1, 2, 3, 5, 6)

    @property
    def can_approve_high_risk(self) -> bool:
        return self.user_roles_id in (1, 2, 5)

    def __repr__(self) -> str:
        return (
            f"CurrentUser(user_id={self.user_id}, "
            f"accountable_institution_id={self.accountable_institution_id}, "
            f"user_roles_id={self.user_roles_id}, "
            f"abilities=[...])"
        )

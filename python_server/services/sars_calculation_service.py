"""SARS-transfer-duty calculation ported from the Node `calculateTransferDuty`.

This service produces DEEDLY estimates only; authoritative SARS assessments are
stored on the `sars_submissions` side as `assessment`.
"""

import json
from dataclasses import dataclass
from decimal import Decimal
from typing import Any, Dict, List, Optional, Union
from uuid import UUID

import db


class SarsCalculationServiceError(Exception):
    """Raised for domain-level calculation errors."""

    pass


# SARS Transfer Duty Rates (Transfer Duty Act 40 of 1949 - Budget Statutory Schedule)
# Continuous boundary semantics: lower-exclusive (except 0), upper-inclusive.
_TRANSFER_DUTY_BRACKETS = [
    {
        "minAmount": Decimal("0"),
        "maxAmount": Decimal("1100000"),
        "rate": Decimal("0"),
        "baseAmount": Decimal("0"),
        "baseThreshold": Decimal("0"),
        "description": "0% (Exempt up to R1,100,000)",
    },
    {
        "minAmount": Decimal("1100000"),
        "maxAmount": Decimal("1512500"),
        "rate": Decimal("0.03"),
        "baseAmount": Decimal("0"),
        "baseThreshold": Decimal("1100000"),
        "description": "3% of the value above R1,100,000",
    },
    {
        "minAmount": Decimal("1512500"),
        "maxAmount": Decimal("2117500"),
        "rate": Decimal("0.06"),
        "baseAmount": Decimal("12375"),
        "baseThreshold": Decimal("1512500"),
        "description": "R12,375 + 6% of the value above R1,512,500",
    },
    {
        "minAmount": Decimal("2117500"),
        "maxAmount": Decimal("2722500"),
        "rate": Decimal("0.08"),
        "baseAmount": Decimal("48675"),
        "baseThreshold": Decimal("2117500"),
        "description": "R48,675 + 8% of the value above R2,117,500",
    },
    {
        "minAmount": Decimal("2722500"),
        "maxAmount": Decimal("12100000"),
        "rate": Decimal("0.11"),
        "baseAmount": Decimal("97075"),
        "baseThreshold": Decimal("2722500"),
        "description": "R97,075 + 11% of the value above R2,722,500",
    },
    {
        "minAmount": Decimal("12100000"),
        "maxAmount": None,
        "rate": Decimal("0.13"),
        "baseAmount": Decimal("1128600"),
        "baseThreshold": Decimal("12100000"),
        "description": "R1,128,600 + 13% of the value above R12,100,000",
    },
]


def _to_decimal(value: Any) -> Decimal:
    if value is None:
        return Decimal("0")
    if isinstance(value, Decimal):
        return value
    return Decimal(str(value))


def calculate_transfer_duty(
    property_value: Union[int, float, Decimal],
    is_vat_transaction: bool = False,
) -> Dict[str, Any]:
    """Return the SARS transfer-duty estimate for a given consideration.

    Ported from ``src/utils/conveyancingAccounts.ts``.
    """
    value = max(Decimal("0"), _to_decimal(property_value))

    if is_vat_transaction:
        return {
            "transfer_duty": Decimal("0"),
            "bracket_tier": "VAT Transaction (Developer Sale)",
            "rate_description": "Exempt from Transfer Duty (Purchase price is subject to VAT)",
            "is_exempt": True,
        }

    matched = _TRANSFER_DUTY_BRACKETS[0]
    for i, bracket in enumerate(_TRANSFER_DUTY_BRACKETS):
        min_amount = bracket["minAmount"]
        max_amount = bracket["maxAmount"]

        if i == 0:
            is_match = value >= min_amount and (max_amount is None or value <= max_amount)
        else:
            is_match = value > min_amount and (max_amount is None or value <= max_amount)

        if is_match:
            matched = bracket
            break

    duty = matched["baseAmount"]
    if matched["rate"] > 0 and value > matched["baseThreshold"]:
        excess = value - matched["baseThreshold"]
        duty += excess * matched["rate"]

    rounded_duty = int(duty.to_integral_value())
    return {
        "transfer_duty": Decimal(rounded_duty),
        "bracket_tier": f"Bracket R{int(matched['minAmount'])} - {'R' + str(int(matched['maxAmount'])) if matched['maxAmount'] else 'Above'}",
        "rate_description": matched["description"],
        "is_exempt": rounded_duty == 0,
    }


def _is_natural(entity_type: str) -> bool:
    return entity_type == "person"


def _allocate_party_duty(
    transfer_duty: Decimal,
    parties: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """Split transfer duty by party share and natural/non-natural flag.

    Equal shares are used when a party has no explicit share percentage.
    """
    if not parties:
        return []

    total_explicit = sum(
        Decimal("0") if p.get("share_percentage") is None else _to_decimal(p["share_percentage"])
        for p in parties
    )
    missing = [p for p in parties if p.get("share_percentage") is None]
    residual = max(Decimal("100") - total_explicit, Decimal("0"))
    equal_share = residual / len(parties) if parties else Decimal("0")

    allocations = []
    for party in parties:
        share = (
            _to_decimal(party.get("share_percentage"))
            if party.get("share_percentage") is not None
            else equal_share
        )
        allocation = (share / Decimal("100")) * transfer_duty
        allocation_type = "natural" if _is_natural(party.get("entity_type", "")) else "non_natural"
        allocations.append(
            {
                "transfer_party_id": str(party["transfer_party_id"]),
                "entity_type": party.get("entity_type"),
                "role": party.get("role"),
                "share_percentage": float(share.quantize(Decimal("0.00"))),
                "allocation_type": allocation_type,
                "allocation_amount": float(allocation.quantize(Decimal("0.00"))),
            }
        )

    return allocations


async def _fetch_calculation_inputs(
    transfer_id: Union[UUID, str], connection: Any = None
) -> Dict[str, Any]:
    from db import query

    transfer_result = await query(
        """
        SELECT purchase_price
        FROM transfers
        WHERE id = $1::uuid
        """,
        [transfer_id],
        connection=connection,
    )
    if not transfer_result.rows:
        raise SarsCalculationServiceError("Transfer not found")

    purchase_price = _to_decimal(transfer_result.rows[0]["purchase_price"] or 0)

    property_result = await query(
        """
        SELECT other_consideration
        FROM sars_property_details
        WHERE transfer_id = $1::uuid
        ORDER BY created_at
        LIMIT 1
        """,
        [transfer_id],
        connection=connection,
    )
    other_consideration = Decimal("0")
    if property_result.rows and property_result.rows[0]["other_consideration"] is not None:
        other_consideration = _to_decimal(property_result.rows[0]["other_consideration"])

    party_result = await query(
        """
        SELECT tp.id AS transfer_party_id, tp.entity_type, tp.role, spd.share_percentage
        FROM transfer_parties tp
        LEFT JOIN sars_party_details spd ON spd.transfer_party_id = tp.id
        WHERE tp.transfer_id = $1::uuid
        ORDER BY tp.created_at
        """,
        [transfer_id],
        connection=connection,
    )
    parties = [dict(r) for r in party_result.rows]

    return {
        "purchase_price": purchase_price,
        "other_consideration": other_consideration,
        "parties": parties,
    }


async def compute_and_persist(
    transfer_id: Union[UUID, str],
    *,
    is_vat_transaction: Optional[bool] = None,
    other_consideration: Optional[Union[int, float, Decimal]] = None,
    penalty_interest: Optional[Union[int, float, Decimal]] = None,
    actor_user_id: Optional[int] = None,
    connection: Any = None,
) -> Dict[str, Any]:
    """Compute the DEEDLY SARS estimate and store it in `sars_calculations`.

    The caller is responsible for authorising the transfer. `connection` is used
    when the operation runs inside an existing transaction.
    """
    from db import query

    inputs = await _fetch_calculation_inputs(transfer_id, connection=connection)

    purchase_price = inputs["purchase_price"]
    other = _to_decimal(other_consideration) if other_consideration is not None else inputs["other_consideration"]
    total_consideration = purchase_price + other

    vat_flag = is_vat_transaction if is_vat_transaction is not None else False
    penalty = _to_decimal(penalty_interest) if penalty_interest is not None else Decimal("0")

    duty_result = calculate_transfer_duty(total_consideration, vat_flag)
    transfer_duty = duty_result["transfer_duty"]

    allocations = _allocate_party_duty(transfer_duty, inputs["parties"])
    sub_total = transfer_duty
    total_payable = sub_total + penalty

    party_allocations_json = json.dumps(allocations)

    sql = """
        INSERT INTO sars_calculations (
            transfer_id,
            calculation_version,
            purchase_price,
            other_consideration,
            total_consideration,
            transfer_duty_payable,
            is_vat_transaction,
            sub_total,
            penalty_interest,
            total_payable,
            party_allocations,
            calculation_data,
            created_by_user_id,
            updated_by_user_id
        )
        VALUES (
            $1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10,
            $11::jsonb, $12::jsonb, $13, $13
        )
        RETURNING *
    """
    params = [
        transfer_id,
        "1.0",
        purchase_price,
        other,
        total_consideration,
        transfer_duty,
        vat_flag,
        sub_total,
        penalty,
        total_payable,
        party_allocations_json,
        json.dumps(
            {
                "bracket_tier": duty_result["bracket_tier"],
                "rate_description": duty_result["rate_description"],
                "is_exempt": duty_result["is_exempt"],
                "source": "sars_calculation_service.py",
            }
        ),
        actor_user_id,
    ]

    result = await query(sql, params, connection=connection)
    if not result.rows:
        raise SarsCalculationServiceError("Failed to persist calculation")

    row = dict(result.rows[0])
    row["party_allocations"] = allocations
    row["calculation_data"] = json.loads(row["calculation_data"])
    return row

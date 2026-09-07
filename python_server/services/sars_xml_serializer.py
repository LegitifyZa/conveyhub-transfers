"""Serialize a SARS TDC01 submission payload to XML.

This is a local serialization boundary. The actual V1.17 XML contract is not
present in the repository, so the output uses a generic, well-formed envelope
that mirrors the canonical payload ownership groups.
"""

import json
from typing import Any, Dict
from xml.etree.ElementTree import Element, SubElement, tostring


class SarsXmlSerializerError(Exception):
    """Raised when a payload cannot be serialized to XML."""

    pass


def _safe_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (dict, list)):
        return json.dumps(value)
    return str(value)


def _append_dict(parent: Element, data: Dict[str, Any]) -> None:
    for key, value in data.items():
        tag = key.replace("_", "-")
        if isinstance(value, dict):
            child = SubElement(parent, tag)
            _append_dict(child, value)
        elif isinstance(value, list):
            child = SubElement(parent, tag)
            for item in value:
                if isinstance(item, dict):
                    item_el = SubElement(child, "item")
                    _append_dict(item_el, item)
                else:
                    item_el = SubElement(child, "item")
                    item_el.text = _safe_text(item)
        else:
            child = SubElement(parent, tag)
            child.text = _safe_text(value)


def serialize(payload: Dict[str, Any]) -> str:
    """Serialize the canonical SARS payload into a UTF-8 XML string."""
    if not isinstance(payload, dict):
        raise SarsXmlSerializerError("Payload must be a dictionary")

    root = Element("sars-transfer-duty-return")
    root.set("version", str(payload.get("payload_version", "1.0")))
    root.set("snapshot-at", str(payload.get("snapshot_at", "")))

    ownership_groups = payload.get("ownership_groups") or {}
    for group_name, group_value in ownership_groups.items():
        group_el = SubElement(root, "ownership-group")
        group_el.set("name", group_name)
        if isinstance(group_value, list):
            for item in group_value:
                item_el = SubElement(group_el, "item")
                _append_dict(item_el, item if isinstance(item, dict) else {"value": item})
        elif isinstance(group_value, dict):
            _append_dict(group_el, group_value)
        else:
            group_el.text = _safe_text(group_value)

    declaration = "<?xml version='1.0' encoding='UTF-8'?>\n"
    return declaration + tostring(root, encoding="unicode")

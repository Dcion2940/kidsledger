#!/usr/bin/env python3

from __future__ import annotations

import plistlib
import uuid
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PUBLIC_DIR = ROOT / "public" / "shortcuts"
TMP_DIR = ROOT / "tmp"
PUBLIC_DIR.mkdir(parents=True, exist_ok=True)
TMP_DIR.mkdir(parents=True, exist_ok=True)

SHORTCUT_NAME = "KidsLedger Siri 行事曆驗證版 v1"
OUTPUT_PATH = PUBLIC_DIR / "kidsledger-siri-calendar-v1.shortcut"
DEBUG_XML_PATH = TMP_DIR / "kidsledger-siri-calendar-v1.xml.shortcut"
API_BASE = "https://kidsledger.pages.dev"
EMAIL_PLACEHOLDER = "{{appUserEmail}}"
SECRET_PLACEHOLDER = "{{shortcutSecret}}"
PLACEHOLDER_CHAR = "\uFFFC"


def upper_uuid() -> str:
    return str(uuid.uuid4()).upper()


def action_output_attachment(output_uuid: str, output_name: str) -> dict:
    return {
        "Type": "ActionOutput",
        "OutputUUID": output_uuid,
        "OutputName": output_name,
    }


def token_string(*parts: object) -> dict:
    text_parts: list[str] = []
    attachments: dict[str, dict] = {}
    cursor = 0

    for part in parts:
        if isinstance(part, str):
            text_parts.append(part)
            cursor += len(part)
            continue

        text_parts.append(PLACEHOLDER_CHAR)
        attachments[f"{{{cursor}, 1}}"] = part
        cursor += 1

    return {
        "Value": {
            "attachmentsByRange": attachments,
            "string": "".join(text_parts),
        },
        "WFSerializationType": "WFTextTokenString",
    }


def dictionary_value(items: list[tuple[str, object]]) -> dict:
    return {
        "Value": {
            "WFDictionaryFieldValueItems": [
                {
                    "WFItemType": 0,
                    "WFKey": token_string(key),
                    "WFValue": token_string(value) if isinstance(value, str) else token_string(value),
                }
                for key, value in items
            ]
        },
        "WFSerializationType": "WFDictionaryFieldValue",
    }


def ask_action(prompt: object, input_type: str = "Text") -> tuple[dict, str]:
    output_uuid = upper_uuid()
    params: dict[str, object] = {
        "UUID": output_uuid,
        "WFAskActionPrompt": prompt if isinstance(prompt, dict) else str(prompt),
        "WFInputType": input_type,
    }
    return (
        {
            "WFWorkflowActionIdentifier": "is.workflow.actions.ask",
            "WFWorkflowActionParameters": params,
        },
        output_uuid,
    )


def speak_action(language: str = "zh-TW", wait: bool = True) -> dict:
    return {
        "WFWorkflowActionIdentifier": "is.workflow.actions.speaktext",
        "WFWorkflowActionParameters": {
            "WFSpeakTextWait": wait,
            "WFSpeakTextLanguage": language,
        },
    }


def if_start_action(expected_text: str, grouping_id: str) -> dict:
    return {
        "WFWorkflowActionIdentifier": "is.workflow.actions.conditional",
        "WFWorkflowActionParameters": {
            "GroupingIdentifier": grouping_id,
            "WFControlFlowMode": 0,
            "WFCondition": "Equals",
            "WFConditionalActionString": token_string(expected_text),
        },
    }


def if_else_action(grouping_id: str) -> dict:
    return {
        "WFWorkflowActionIdentifier": "is.workflow.actions.conditional",
        "WFWorkflowActionParameters": {
            "GroupingIdentifier": grouping_id,
            "WFControlFlowMode": 1,
        },
    }


def if_end_action(grouping_id: str) -> dict:
    return {
        "WFWorkflowActionIdentifier": "is.workflow.actions.conditional",
        "WFWorkflowActionParameters": {
            "GroupingIdentifier": grouping_id,
            "WFControlFlowMode": 2,
        },
    }


def download_url_action(url: str, json_items: list[tuple[str, object]]) -> dict:
    return {
        "WFWorkflowActionIdentifier": "is.workflow.actions.downloadurl",
        "WFWorkflowActionParameters": {
            "Advanced": True,
            "WFHTTPMethod": "POST",
            "WFHTTPBodyType": "JSON",
            "WFURL": url,
            "WFJSONValues": dictionary_value(json_items),
        },
    }


def show_result_action(text: str) -> dict:
    return {
        "WFWorkflowActionIdentifier": "is.workflow.actions.showresult",
        "WFWorkflowActionParameters": {
            "Text": token_string(text),
        },
    }


def build_shortcut() -> dict:
    request_action, request_uuid = ask_action("你要我幫你記錄什麼行事曆？")
    confirm_action, _ = ask_action("如果正確請輸入 確認，其他內容都視為取消。")
    if_group = upper_uuid()

    actions = [
        request_action,
        download_url_action(
            f"{API_BASE}/api/calendar/shortcut-ai/prepare",
            [
                ("shortcutSecret", SECRET_PLACEHOLDER),
                ("appUserEmail", EMAIL_PLACEHOLDER),
                ("text", action_output_attachment(request_uuid, "Ask for Input")),
            ],
        ),
        speak_action(),
        confirm_action,
        if_start_action("確認", if_group),
        download_url_action(
            f"{API_BASE}/api/calendar/shortcut-ai/commit",
            [
                ("shortcutSecret", SECRET_PLACEHOLDER),
                ("appUserEmail", EMAIL_PLACEHOLDER),
            ],
        ),
        speak_action(),
        if_else_action(if_group),
        show_result_action("這次先不新增。"),
        if_end_action(if_group),
    ]

    return {
        "WFWorkflowActions": actions,
        "WFWorkflowClientRelease": "18.0",
        "WFWorkflowClientVersion": "3036.0.4",
        "WFWorkflowHasOutputFallback": False,
        "WFWorkflowIcon": {
            "WFWorkflowIconGlyphNumber": 61461,
            "WFWorkflowIconStartColor": 4282601983,
        },
        "WFWorkflowImportQuestions": [
            {
                "WFWorkflowImportQuestionType": "Text",
                "WFWorkflowImportQuestionPrompt": "KidsLedger app user email",
                "WFWorkflowImportQuestionDefaultValue": "",
                "WFWorkflowImportQuestionVariable": "appUserEmail",
            },
            {
                "WFWorkflowImportQuestionType": "Text",
                "WFWorkflowImportQuestionPrompt": "Calendar shortcut secret",
                "WFWorkflowImportQuestionDefaultValue": "",
                "WFWorkflowImportQuestionVariable": "shortcutSecret",
            },
        ],
        "WFWorkflowMinimumClientVersion": 900,
        "WFWorkflowMinimumClientVersionString": "900",
        "WFWorkflowName": SHORTCUT_NAME,
        "WFWorkflowOutputContentItemClasses": [],
        "WFWorkflowTypes": [],
    }


def main() -> None:
    workflow = build_shortcut()
    with OUTPUT_PATH.open("wb") as handle:
      plistlib.dump(workflow, handle, fmt=plistlib.FMT_BINARY, sort_keys=False)
    with DEBUG_XML_PATH.open("wb") as handle:
      plistlib.dump(workflow, handle, fmt=plistlib.FMT_XML, sort_keys=False)
    print(OUTPUT_PATH)


if __name__ == "__main__":
    main()

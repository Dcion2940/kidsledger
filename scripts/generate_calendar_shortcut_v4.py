#!/usr/bin/env python3

from __future__ import annotations

import plistlib
import subprocess
import uuid
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
UNSIGNED_PATH = ROOT / "tmp" / "kidsledger-calendar-v4.unsigned.shortcut"
SIGNED_PATH = ROOT / "public" / "shortcuts" / "kidsledger-calendar-v4.shortcut"
EMAIL_PLACEHOLDER = "REPLACE_WITH_APP_USER_EMAIL"
SECRET_PLACEHOLDER = "REPLACE_WITH_SHORTCUT_SECRET"
API_URL = "https://kidsledger.pages.dev/api/calendar/shortcut-create"
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
        attachments[f"{{{cursor}, 1}}"] = part  # type: ignore[index]
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


def ask_action(prompt: object, input_type: str = "Text", granularity: str | None = None) -> tuple[dict, str]:
    output_uuid = upper_uuid()
    params: dict[str, object] = {
        "UUID": output_uuid,
        "WFAskActionPrompt": prompt if isinstance(prompt, dict) else str(prompt),
        "WFInputType": input_type,
    }
    if input_type == "Date" and granularity:
        params["WFAskActionDateGranularity"] = granularity
    return (
        {
            "WFWorkflowActionIdentifier": "is.workflow.actions.ask",
            "WFWorkflowActionParameters": params,
        },
        output_uuid,
    )


def speak_action() -> dict:
    return {
        "WFWorkflowActionIdentifier": "is.workflow.actions.speaktext",
        "WFWorkflowActionParameters": {
            "WFSpeakTextWait": True,
            "WFSpeakTextLanguage": "zh-TW",
        },
    }


def text_action(text: dict) -> tuple[dict, str]:
    output_uuid = upper_uuid()
    return (
        {
            "WFWorkflowActionIdentifier": "is.workflow.actions.gettext",
            "WFWorkflowActionParameters": {
                "UUID": output_uuid,
                "WFTextActionText": text,
            },
        },
        output_uuid,
    )


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


def download_url_action(title_uuid: str, date_uuid: str, time_uuid: str) -> dict:
    return {
        "WFWorkflowActionIdentifier": "is.workflow.actions.downloadurl",
        "WFWorkflowActionParameters": {
            "Advanced": True,
            "WFHTTPMethod": "POST",
            "WFHTTPBodyType": "JSON",
            "WFURL": API_URL,
            "WFJSONValues": dictionary_value(
                [
                    ("shortcutSecret", SECRET_PLACEHOLDER),
                    ("appUserEmail", EMAIL_PLACEHOLDER),
                    ("title", action_output_attachment(title_uuid, "Ask for Input")),
                    ("date", action_output_attachment(date_uuid, "Ask for Input")),
                    ("timeRange", action_output_attachment(time_uuid, "Ask for Input")),
                ]
            ),
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
    title_action, title_uuid = ask_action("請輸入行事曆標題")
    date_action, date_uuid = ask_action("請選擇日期", input_type="Date", granularity="Date")
    time_action, time_uuid = ask_action("請輸入時間，例如 09:00-10:00；若為全天請輸入 全天")

    summary_action, summary_uuid = text_action(
        token_string(
            "請確認是否新增這筆行事曆：\n標題：",
            action_output_attachment(title_uuid, "Ask for Input"),
            "\n日期：",
            action_output_attachment(date_uuid, "Ask for Input"),
            "\n時間：",
            action_output_attachment(time_uuid, "Ask for Input"),
            "\n\n若要新增，請輸入「確認」，其他內容都視為取消。"
        )
    )
    confirm_action, _ = ask_action(action_output_attachment(summary_uuid, "Text"))

    if_group = upper_uuid()

    actions = [
        title_action,
        speak_action(),
        date_action,
        time_action,
        summary_action,
        confirm_action,
        if_start_action("確認", if_group),
        download_url_action(title_uuid, date_uuid, time_uuid),
        show_result_action("已送出到 KidsLedger 家庭行事曆。"),
        if_else_action(if_group),
        show_result_action("這次沒有新增行事曆。"),
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
        "WFWorkflowImportQuestions": [],
        "WFWorkflowMinimumClientVersion": 900,
        "WFWorkflowMinimumClientVersionString": "900",
        "WFWorkflowName": "KidsLedger 快速新增行事曆 v4",
        "WFWorkflowOutputContentItemClasses": [],
        "WFWorkflowTypes": [],
    }


def main() -> None:
    UNSIGNED_PATH.parent.mkdir(parents=True, exist_ok=True)
    SIGNED_PATH.parent.mkdir(parents=True, exist_ok=True)

    with UNSIGNED_PATH.open("wb") as handle:
        plistlib.dump(build_shortcut(), handle, fmt=plistlib.FMT_XML, sort_keys=False)

    subprocess.run(
        [
            "shortcuts",
            "sign",
            "--mode",
            "anyone",
            "--input",
            str(UNSIGNED_PATH),
            "--output",
            str(SIGNED_PATH),
        ],
        check=True,
    )


if __name__ == "__main__":
    main()

import plistlib
from pathlib import Path

ROOT = Path("/Users/milo/Downloads/kidsledger")
PUBLIC_DIR = ROOT / "public" / "shortcuts"
PUBLIC_DIR.mkdir(parents=True, exist_ok=True)

unsigned_path = PUBLIC_DIR / "KidsLedger-Quick-Add-unsigned.shortcut"

workflow = {
    "WFWorkflow": {
        "WFWorkflowClientRelease": "18.0",
        "WFWorkflowClientVersion": "1302.1.3",
        "WFWorkflowIcon": {
            "WFWorkflowIconStartColor": 4282601983,
            "WFWorkflowIconGlyphNumber": 61461
        },
        "WFWorkflowImportQuestions": [
            {
                "WFWorkflowImportQuestionType": "Text",
                "WFWorkflowImportQuestionPrompt": "KidsLedger API URL",
                "WFWorkflowImportQuestionDefaultValue": "https://kidsledger.pages.dev/api/calendar/shortcut-create",
                "WFWorkflowImportQuestionVariable": "shortcutApiUrl"
            },
            {
                "WFWorkflowImportQuestionType": "Text",
                "WFWorkflowImportQuestionPrompt": "KidsLedger app user email",
                "WFWorkflowImportQuestionDefaultValue": "",
                "WFWorkflowImportQuestionVariable": "appUserEmail"
            },
            {
                "WFWorkflowImportQuestionType": "Text",
                "WFWorkflowImportQuestionPrompt": "Calendar shortcut secret",
                "WFWorkflowImportQuestionDefaultValue": "",
                "WFWorkflowImportQuestionVariable": "shortcutSecret"
            }
        ],
        "WFWorkflowInputContentItemClasses": [
            "WFTextContentItem"
        ],
        "WFWorkflowMinimumClientVersion": 1300,
        "WFWorkflowMinimumClientVersionString": "1300",
        "WFWorkflowOutputContentItemClasses": [],
        "WFWorkflowHasOutputFallback": False,
        "WFWorkflowTypes": ["ActionExtension", "MenuBar"],
        "WFWorkflowHasShortcutInputVariables": True,
        "WFWorkflowActions": [
            {
                "WFWorkflowActionIdentifier": "is.workflow.actions.ask",
                "WFWorkflowActionParameters": {
                    "WFAskActionPrompt": "事件標題",
                    "WFInputType": "Text"
                }
            },
            {
                "WFWorkflowActionIdentifier": "is.workflow.actions.setvariable",
                "WFWorkflowActionParameters": {
                    "WFVariableName": "title"
                }
            },
            {
                "WFWorkflowActionIdentifier": "is.workflow.actions.ask",
                "WFWorkflowActionParameters": {
                    "WFAskActionPrompt": "日期（YYYY-MM-DD）",
                    "WFInputType": "Text"
                }
            },
            {
                "WFWorkflowActionIdentifier": "is.workflow.actions.setvariable",
                "WFWorkflowActionParameters": {
                    "WFVariableName": "date"
                }
            },
            {
                "WFWorkflowActionIdentifier": "is.workflow.actions.ask",
                "WFWorkflowActionParameters": {
                    "WFAskActionPrompt": "開始時間（24 小時制，例如 09:30；全天可留空）",
                    "WFInputType": "Text"
                }
            },
            {
                "WFWorkflowActionIdentifier": "is.workflow.actions.setvariable",
                "WFWorkflowActionParameters": {
                    "WFVariableName": "startTime"
                }
            },
            {
                "WFWorkflowActionIdentifier": "is.workflow.actions.ask",
                "WFWorkflowActionParameters": {
                    "WFAskActionPrompt": "結束時間（24 小時制，例如 10:30；全天可留空）",
                    "WFInputType": "Text"
                }
            },
            {
                "WFWorkflowActionIdentifier": "is.workflow.actions.setvariable",
                "WFWorkflowActionParameters": {
                    "WFVariableName": "endTime"
                }
            },
            {
                "WFWorkflowActionIdentifier": "is.workflow.actions.ask",
                "WFWorkflowActionParameters": {
                    "WFAskActionPrompt": "地點（可留空）",
                    "WFInputType": "Text"
                }
            },
            {
                "WFWorkflowActionIdentifier": "is.workflow.actions.setvariable",
                "WFWorkflowActionParameters": {
                    "WFVariableName": "location"
                }
            },
            {
                "WFWorkflowActionIdentifier": "is.workflow.actions.ask",
                "WFWorkflowActionParameters": {
                    "WFAskActionPrompt": "描述（可留空）",
                    "WFInputType": "Text"
                }
            },
            {
                "WFWorkflowActionIdentifier": "is.workflow.actions.setvariable",
                "WFWorkflowActionParameters": {
                    "WFVariableName": "description"
                }
            },
            {
                "WFWorkflowActionIdentifier": "is.workflow.actions.ask",
                "WFWorkflowActionParameters": {
                    "WFAskActionPrompt": "是否為全天事件？輸入 y 代表是，其餘代表否",
                    "WFInputType": "Text"
                }
            },
            {
                "WFWorkflowActionIdentifier": "is.workflow.actions.setvariable",
                "WFWorkflowActionParameters": {
                    "WFVariableName": "allDay"
                }
            },
            {
                "WFWorkflowActionIdentifier": "is.workflow.actions.dictionary",
                "WFWorkflowActionParameters": {
                    "WFItems": {
                        "Value": {
                            "WFDictionaryFieldValueItems": [
                                {"WFItemType": 0, "WFKey": "appUserEmail", "WFValue": "{{appUserEmail}}"},
                                {"WFItemType": 0, "WFKey": "title", "WFValue": "{{title}}"},
                                {"WFItemType": 0, "WFKey": "date", "WFValue": "{{date}}"},
                                {"WFItemType": 0, "WFKey": "startTime", "WFValue": "{{startTime}}"},
                                {"WFItemType": 0, "WFKey": "endTime", "WFValue": "{{endTime}}"},
                                {"WFItemType": 0, "WFKey": "location", "WFValue": "{{location}}"},
                                {"WFItemType": 0, "WFKey": "description", "WFValue": "{{description}}"},
                                {"WFItemType": 0, "WFKey": "allDay", "WFValue": "{{allDay}}"},
                                {"WFItemType": 0, "WFKey": "autoRolloverEnabled", "WFValue": "false"},
                                {"WFItemType": 0, "WFKey": "actorName", "WFValue": "iPhone 捷徑"}
                            ]
                        },
                        "WFSerializationType": "WFDictionaryFieldValue"
                    }
                }
            },
            {
                "WFWorkflowActionIdentifier": "is.workflow.actions.getjsonfromdictionary",
                "WFWorkflowActionParameters": {
                    "UUID": "7F6CCF41-D37C-47BC-9481-6D4CE070A001"
                }
            },
            {
                "WFWorkflowActionIdentifier": "is.workflow.actions.downloadurl",
                "WFWorkflowActionParameters": {
                    "WFURL": "{{shortcutApiUrl}}",
                    "WFHTTPMethod": "POST",
                    "WFHTTPBodyType": "JSON",
                    "WFJSONValues": {
                        "Value": {
                            "OutputUUID": "7F6CCF41-D37C-47BC-9481-6D4CE070A001",
                            "Type": "ActionOutput"
                        },
                        "WFSerializationType": "WFTextTokenAttachment"
                    },
                    "WFHTTPHeaders": {
                        "Value": {
                            "WFDictionaryFieldValueItems": [
                                {"WFItemType": 0, "WFKey": "Content-Type", "WFValue": "application/json"},
                                {"WFItemType": 0, "WFKey": "x-calendar-shortcut-secret", "WFValue": "{{shortcutSecret}}"}
                            ]
                        },
                        "WFSerializationType": "WFDictionaryFieldValue"
                    }
                }
            },
            {
                "WFWorkflowActionIdentifier": "is.workflow.actions.showresult",
                "WFWorkflowActionParameters": {}
            }
        ]
    }
}

with unsigned_path.open("wb") as f:
    plistlib.dump(workflow, f, fmt=plistlib.FMT_BINARY)

print(unsigned_path)

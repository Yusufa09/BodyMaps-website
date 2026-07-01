from __future__ import annotations

import re
from typing import Any

ALLOWED_ACTION_TYPES = {
    "isolate_organs",
    "show_organs",
    "hide_organs",
    "focus_organ",
    "get_organ_metric",
    "set_opacity",
    "set_window",
    "set_window_preset",
    "set_zoom",
    "zoom_to_fit",
    "set_view",
    "activate_measurement_tool",
    "clear_measurements",
    "list_structures",
    "get_structure_count",
    "get_largest_structure",
    "get_smallest_structure",
}

ALLOWED_VIEW_MODES = {"mpr", "axial", "sagittal", "coronal", "3d"}
ALLOWED_PRESETS = {"soft_tissue", "bone", "lung", "liver"}
ALLOWED_METRICS = {"volume_cm3", "mean_hu", "all"}
ALLOWED_TOOLS = {"distance", "probe", "roi"}

ORGAN_SYNONYMS = {
    "liver": ["liver", "hepatic"],
    "pancreas": ["pancreas", "pancreatic"],
    "spleen": ["spleen", "splenic"],
    "kidney_left": ["left kidney", "kidney left", "left renal"],
    "kidney_right": ["right kidney", "kidney right", "right renal"],
    "stomach": ["stomach", "gastric"],
    "duodenum": ["duodenum"],
    "colon": ["colon", "large intestine"],
    "intestine": ["intestine", "small intestine", "bowel"],
    "bladder": ["bladder", "urinary bladder"],
    "gall_bladder": ["gall bladder", "gallbladder"],
    "aorta": ["aorta"],
    "postcava": ["postcava", "vena cava", "inferior vena cava", "ivc"],
    "adrenal_gland_left": ["left adrenal", "left adrenal gland"],
    "adrenal_gland_right": ["right adrenal", "right adrenal gland"],
    "femur_left": ["left femur"],
    "femur_right": ["right femur"],
    "prostate": ["prostate"],
    "celiac_artery": ["celiac artery"],
    "superior_mesenteric_artery": ["superior mesenteric artery", "sma"],
    "common_bile_duct": ["common bile duct", "bile duct"],
    "veins": ["veins", "vein"],
}


def _normalize(text: str) -> str:
    value = text.lower().strip()
    value = value.replace("hounsfield unit", "hu").replace("hounsfield units", "hu")
    value = value.replace("3 d", "3d")
    value = re.sub(r"[^\w\s%.-]", " ", value)
    value = re.sub(r"\s+", " ", value)
    return value.strip()


def _pretty_organ(value: str) -> str:
    return value.replace("_", " ").title()


def _contains_any(text: str, terms: list[str]) -> bool:
    return any(term in text for term in terms)


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _organ_aliases_for_available(organ: str) -> list[str]:
    aliases = set()
    base = _normalize(organ).replace(" ", "_")
    spaced = base.replace("_", " ")
    aliases.add(base)
    aliases.add(spaced)
    if base in ORGAN_SYNONYMS:
        aliases.update(ORGAN_SYNONYMS[base])
    parts = base.split("_")
    if len(parts) == 2 and parts[1] in {"left", "right"}:
        aliases.add(f"{parts[1]} {parts[0]}")
    if len(parts) >= 3 and parts[-1] in {"left", "right"}:
        aliases.add(f"{parts[-1]} {' '.join(parts[:-1])}")
    return sorted(aliases, key=len, reverse=True)


def _match_organs(text: str, available_organs: list[str]) -> list[str]:
    norm = _normalize(text)
    matched = []
    if any(phrase in norm for phrase in ["kidneys", "both kidneys", "both kidney"]):
        for organ in available_organs:
            if "kidney" in _normalize(organ) and organ not in matched:
                matched.append(organ)
    for organ in available_organs:
        for alias in _organ_aliases_for_available(organ):
            if alias and re.search(rf"\b{re.escape(alias.replace('_', ' '))}\b", norm):
                if organ not in matched:
                    matched.append(organ)
                break
    if not matched:
        words = set(norm.split())
        for organ in available_organs:
            organ_words = set(_normalize(organ).split()) - {"left", "right", "the", "and"}
            if organ_words and organ_words.issubset(words):
                matched.append(organ)
    return matched


def _educational_answer(norm: str) -> str | None:
    if _contains_any(norm, ["what is a ct scan", "what is ct scan", "explain ct scan", "computed tomography"]):
        return "A CT scan, or computed tomography scan, uses X-rays taken from multiple angles and computer processing to create cross-sectional images of the body. In this viewer, the CT image is shown with segmented anatomical structures overlaid in color."
    if _contains_any(norm, ["what is segmentation", "what does segmentation mean", "segmented structure", "segmented organ"]):
        return "Segmentation means labeling specific anatomical structures in the scan, such as the liver, spleen, pancreas, kidneys, vessels, or bones. The colored overlays represent those segmented regions so you can see where each structure is located."
    if _contains_any(norm, ["colored overlay", "colored overlays", "what are the colors", "what do the colors mean"]):
        return "The colored overlays are segmentation masks. Each color corresponds to a different labeled structure in the CT scan. They help separate organs and anatomical regions from the grayscale CT image."
    if _contains_any(norm, ["what is hu", "what are hu", "hounsfield", "mean hu"]):
        return "HU stands for Hounsfield Unit. It is a CT intensity scale where air is very low, water is around 0, soft tissues fall in intermediate ranges, and dense bone is high. Mean HU is the average CT intensity inside a selected organ or region."
    if _contains_any(norm, ["what is roi", "roi tool", "region of interest"]):
        return "ROI means region of interest. In medical imaging, an ROI is an area selected for measurement. In this viewer, the ROI tool lets you draw a region on the CT image."
    if _contains_any(norm, ["distance tool", "measure distance", "distance measurement"]):
        return "The distance tool lets you click two points in the CT viewer to measure the distance between them. This is useful for estimating sizes or spacing between structures."
    if _contains_any(norm, ["brightness", "contrast", "windowing", "window level", "window width", "ct window"]):
        return "CT windowing controls how grayscale intensities are displayed. Window width mainly affects contrast, while window center affects brightness. Presets such as soft tissue, bone, lung, and liver make different tissues easier to see."
    if "bone window" in norm:
        return "A bone window uses a wide CT window to make dense structures like bone easier to see."
    if "lung window" in norm:
        return "A lung window is optimized for air-filled lung tissue and low-density structures."
    if "soft tissue window" in norm:
        return "A soft tissue window is designed to show organs, muscles, vessels, and other soft tissues more clearly."
    if _contains_any(norm, ["axial", "sagittal", "coronal", "mpr"]):
        return "Axial, sagittal, and coronal are standard CT viewing planes. Axial shows slices across the body, sagittal shows side views, and coronal shows front-facing views. MPR means multiplanar reconstruction, where these views are shown together."
    if _contains_any(norm, ["3d view", "3d segmentation", "three dimensional"]):
        return "The 3D view shows the segmented anatomy as a three-dimensional model. It helps show the spatial relationship between structures."
    if _contains_any(norm, ["how do i move through", "move through ct slices", "scroll through slices", "navigate slices"]):
        return "To move through CT slices, scroll over a 2D CT pane or use the viewer navigation controls. The crosshair helps link the axial, sagittal, and coronal views."
    if "crosshair" in norm:
        return "The crosshair marks a shared location across the CT views. Moving it in one plane helps locate the same point in the axial, sagittal, coronal, and 3D views."
    organ_answers = {
        "liver": "The liver is a large organ in the upper abdomen. It helps process nutrients, produce bile, store energy, and filter substances from the blood.",
        "pancreas": "The pancreas is an abdominal organ involved in digestion and blood sugar regulation. It produces digestive enzymes and hormones such as insulin.",
        "spleen": "The spleen helps filter blood, supports immune function, and manages blood cells. It is located in the upper left abdomen.",
        "kidney": "The kidneys filter blood, remove waste products, regulate fluid balance, and help control blood pressure. Most people have a left and right kidney.",
        "stomach": "The stomach stores food, mixes it with acid and enzymes, and begins digestion.",
        "colon": "The colon, or large intestine, absorbs water and helps form and move stool through the digestive tract.",
        "intestine": "The intestines are part of the digestive system. The small intestine absorbs nutrients, while the large intestine absorbs water and helps form stool.",
        "bladder": "The bladder stores urine before it leaves the body. It sits in the pelvis and expands as it fills.",
        "gallbladder": "The gallbladder stores bile produced by the liver and releases it to help digest fats.",
        "aorta": "The aorta is the main artery that carries oxygen-rich blood from the heart to the rest of the body.",
        "adrenal": "The adrenal glands sit above the kidneys and produce hormones involved in stress response, blood pressure, and metabolism.",
        "femur": "The femur is the thigh bone and is one of the strongest and largest bones in the body.",
        "prostate": "The prostate is a gland in the male pelvis that contributes fluid to semen.",
        "duodenum": "The duodenum is the first part of the small intestine. It receives partially digested food from the stomach and digestive juices from the pancreas and bile ducts.",
    }
    for key, answer in organ_answers.items():
        if f"what does the {key}" in norm or f"what is the {key}" in norm or f"function of the {key}" in norm or f"explain the {key}" in norm or f"tell me about the {key}" in norm:
            return answer
    if _contains_any(norm, ["what can you do", "help", "commands", "how can you help"]):
        return "I can explain CT and anatomy concepts, isolate organs, show or hide structures, change opacity, adjust CT window settings, activate ROI or distance tools, list segmented structures, and retrieve available organ metrics."
    return None


def _unsafe_medical_request(norm: str) -> bool:
    patterns = [
        "do i have",
        "does this show cancer",
        "is this cancer",
        "is this tumor",
        "is it malignant",
        "is it benign",
        "what disease do i have",
        "diagnose",
        "diagnosis",
        "treatment",
        "what should i take",
        "am i sick",
        "is this normal",
        "is this abnormal",
        "interpret this scan",
        "read this scan",
    ]
    return any(pattern in norm for pattern in patterns)


def _unsafe_reply() -> dict[str, Any]:
    return {
        "reply": "I can't diagnose, interpret disease, determine whether something is cancer, or recommend treatment from this scan. A radiologist or qualified clinician should review the imaging and clinical history. I can still explain CT concepts or help you visualize and measure segmented structures.",
        "actions": [],
        "source": "hardcoded",
        "intent": "unsafe_medical_request",
    }


def _parse_case_data_question(norm: str) -> dict[str, Any] | None:
    if _contains_any(norm, ["how many structures", "how many organs", "how many segmented", "number of structures", "number of organs", "number of segmented", "count structures", "count organs"]):
        return {"type": "get_structure_count"}
    list_terms = ["list structures", "list the structures", "list organs", "list the organs", "what structures", "which structures", "what organs", "which organs", "structures present", "organs present"]
    if _contains_any(norm, list_terms) or (("segmented structures" in norm or "segmented organs" in norm) and ("list" in norm or "present" in norm)):
        return {"type": "list_structures"}
    if _contains_any(norm, ["largest", "biggest", "highest volume", "most volume"]) and _contains_any(norm, ["organ", "structure", "segmented", "scan", "case"]):
        return {"type": "get_largest_structure"}
    if _contains_any(norm, ["smallest", "tiniest", "lowest volume", "least volume"]) and _contains_any(norm, ["organ", "structure", "segmented", "scan", "case"]):
        return {"type": "get_smallest_structure"}
    return None


def _parse_opacity(norm: str, viewer_state: dict[str, Any]) -> dict[str, Any] | None:
    explicit = re.search(r"(?:opacity|transparent|transparency)\s*(?:to|=|:)?\s*(\d+(?:\.\d+)?)\s*%?", norm)
    if explicit:
        return {"type": "set_opacity", "value": _clamp(float(explicit.group(1)), 0, 100)}
    current = float(viewer_state.get("opacity", 70) or 70)
    if _contains_any(norm, ["more transparent", "less opaque", "decrease opacity", "lower opacity", "reduce opacity"]):
        return {"type": "set_opacity", "value": _clamp(current - 20, 0, 100)}
    if _contains_any(norm, ["less transparent", "more opaque", "increase opacity", "raise opacity", "higher opacity"]):
        return {"type": "set_opacity", "value": _clamp(current + 20, 0, 100)}
    return None


def _parse_window(norm: str, viewer_state: dict[str, Any]) -> list[dict[str, Any]]:
    actions = []
    presets = {"soft tissue": "soft_tissue", "bone": "bone", "lung": "lung", "liver window": "liver"}
    for phrase, preset in presets.items():
        if phrase in norm and ("window" in norm or phrase != "liver window"):
            return [{"type": "set_window_preset", "preset": preset}]
    width = float(viewer_state.get("windowWidth", 400) or 400)
    center = float(viewer_state.get("windowCenter", 50) or 50)
    if _contains_any(norm, ["increase brightness", "brighter", "make brighter"]):
        actions.append({"type": "set_window", "width": width, "center": center + 40})
    if _contains_any(norm, ["decrease brightness", "darker", "make darker", "lower brightness"]):
        actions.append({"type": "set_window", "width": width, "center": center - 40})
    if _contains_any(norm, ["increase contrast", "more contrast"]):
        actions.append({"type": "set_window", "width": max(1, width - 80), "center": center})
    if _contains_any(norm, ["decrease contrast", "less contrast", "lower contrast"]):
        actions.append({"type": "set_window", "width": width + 80, "center": center})
    ww = re.search(r"(?:window width|ww|contrast)\s*(?:to|=|:)?\s*(-?\d+(?:\.\d+)?)", norm)
    wc = re.search(r"(?:window center|window level|wc|level|brightness)\s*(?:to|=|:)?\s*(-?\d+(?:\.\d+)?)", norm)
    if ww or wc:
        actions.append({"type": "set_window", "width": max(1, float(ww.group(1)) if ww else width), "center": float(wc.group(1)) if wc else center})
    return actions


def _parse_view(norm: str) -> dict[str, Any] | None:
    if "mpr" in norm or "multi planar" in norm or "multiplanar" in norm:
        return {"type": "set_view", "view": "mpr"}
    if "axial" in norm:
        return {"type": "set_view", "view": "axial"}
    if "sagittal" in norm or "side view" in norm:
        return {"type": "set_view", "view": "sagittal"}
    if "coronal" in norm or "front view" in norm:
        return {"type": "set_view", "view": "coronal"}
    if "3d" in norm or "three dimensional" in norm or "volume view" in norm:
        return {"type": "set_view", "view": "3d"}
    return None


def _parse_zoom(norm: str, viewer_state: dict[str, Any]) -> dict[str, Any] | None:
    current = float(viewer_state.get("zoomLevel", 1) or 1)
    explicit = re.search(r"zoom\s*(?:to|=|:)?\s*(\d+(?:\.\d+)?)", norm)
    if explicit:
        return {"type": "set_zoom", "value": _clamp(float(explicit.group(1)), 0.1, 20)}
    if "zoom to fit" in norm or "fit to screen" in norm or "reset zoom" in norm:
        return {"type": "zoom_to_fit"}
    if "zoom in" in norm:
        return {"type": "set_zoom", "value": _clamp(current + 0.25, 0.1, 20)}
    if "zoom out" in norm:
        return {"type": "set_zoom", "value": _clamp(current - 0.25, 0.1, 20)}
    return None


def _parse_measurement(norm: str) -> dict[str, Any] | None:
    if "clear measurement" in norm or "remove measurement" in norm or "delete measurement" in norm:
        return {"type": "clear_measurements"}
    if "roi" in norm or "region of interest" in norm or "area tool" in norm:
        return {"type": "activate_measurement_tool", "tool": "roi"}
    if "distance" in norm or "ruler" in norm or "measure length" in norm:
        return {"type": "activate_measurement_tool", "tool": "distance"}
    if "hu probe" in norm or "probe" in norm or "point hu" in norm or "click hu" in norm:
        return {"type": "activate_measurement_tool", "tool": "probe"}
    return None


def _parse_organ_actions(norm: str, available_organs: list[str]) -> list[dict[str, Any]]:
    actions = []
    organs = _match_organs(norm, available_organs)
    if not organs:
        return actions
    if _contains_any(norm, ["volume", "how big", "size"]):
        actions.append({"type": "get_organ_metric", "organ": organs[0], "metric": "volume_cm3"})
    if _contains_any(norm, ["mean hu", "average hu", "hu of", "hounsfield"]):
        actions.append({"type": "get_organ_metric", "organ": organs[0], "metric": "mean_hu"})
    if _contains_any(norm, ["statistics", "stats", "metrics"]):
        actions.append({"type": "get_organ_metric", "organ": organs[0], "metric": "all"})
    if _contains_any(norm, ["only show", "show only", "isolate", "segment", "segmentation of", "just show", "display only"]):
        actions.append({"type": "isolate_organs", "organs": organs})
        return actions
    if _contains_any(norm, ["hide", "remove", "turn off"]):
        actions.append({"type": "hide_organs", "organs": organs})
        return actions
    if _contains_any(norm, ["focus", "center", "go to", "jump to", "navigate to"]):
        actions.append({"type": "focus_organ", "organ": organs[0]})
        return actions
    if _contains_any(norm, ["show", "display", "highlight", "make visible"]):
        actions.append({"type": "show_organs", "organs": organs})
    return actions


def _validate_action(action: dict[str, Any], available_organs: list[str]) -> bool:
    action_type = action.get("type")
    if action_type not in ALLOWED_ACTION_TYPES:
        return False
    if action_type in {"isolate_organs", "show_organs", "hide_organs"}:
        organs = action.get("organs")
        if not isinstance(organs, list) or not organs:
            return False
        action["organs"] = [organ for organ in organs if organ in available_organs]
        return len(action["organs"]) > 0
    if action_type == "focus_organ":
        return isinstance(action.get("organ"), str) and action["organ"] in available_organs
    if action_type == "get_organ_metric":
        return isinstance(action.get("organ"), str) and action["organ"] in available_organs and action.get("metric") in ALLOWED_METRICS
    if action_type == "set_opacity":
        value = action.get("value")
        if not isinstance(value, int | float):
            return False
        action["value"] = _clamp(float(value), 0, 100)
        return True
    if action_type == "set_window":
        return isinstance(action.get("width"), int | float) and isinstance(action.get("center"), int | float)
    if action_type == "set_window_preset":
        return action.get("preset") in ALLOWED_PRESETS
    if action_type == "set_zoom":
        value = action.get("value")
        if not isinstance(value, int | float):
            return False
        action["value"] = _clamp(float(value), 0.1, 20)
        return True
    if action_type == "set_view":
        return action.get("view") in ALLOWED_VIEW_MODES
    if action_type == "activate_measurement_tool":
        return action.get("tool") in ALLOWED_TOOLS
    return True


def _action_label(action: dict[str, Any]) -> str:
    action_type = action.get("type")
    if action_type == "isolate_organs":
        return f"Click below to isolate {', '.join(_pretty_organ(organ) for organ in action.get('organs', []))}."
    if action_type == "show_organs":
        return f"Click below to show {', '.join(_pretty_organ(organ) for organ in action.get('organs', []))}."
    if action_type == "hide_organs":
        return f"Click below to hide {', '.join(_pretty_organ(organ) for organ in action.get('organs', []))}."
    if action_type == "focus_organ":
        return f"Click below to focus on {_pretty_organ(action.get('organ', 'the organ'))}."
    if action_type == "get_organ_metric":
        organ = _pretty_organ(action.get("organ", "organ"))
        metric = action.get("metric", "all")
        if metric == "volume_cm3":
            return f"Click below to calculate the volume of {organ}."
        if metric == "mean_hu":
            return f"Click below to calculate the mean HU of {organ}."
        return f"Click below to calculate metrics for {organ}."
    labels = {
        "get_largest_structure": "Click below to calculate the largest segmented structure.",
        "get_smallest_structure": "Click below to calculate the smallest segmented structure.",
        "list_structures": "Click below to list the segmented structures.",
        "get_structure_count": "Click below to count the segmented structures.",
        "zoom_to_fit": "Click below to reset zoom to fit.",
        "clear_measurements": "Click below to clear measurements.",
    }
    if action_type in labels:
        return labels[action_type]
    if action_type == "activate_measurement_tool":
        return f"Click below to activate the {action.get('tool')} tool."
    if action_type == "set_opacity":
        return f"Click below to set opacity to {action.get('value'):.0f}%."
    if action_type == "set_window_preset":
        return f"Click below to apply the {str(action.get('preset')).replace('_', ' ')} window preset."
    if action_type == "set_window":
        return "Click below to apply the CT window change."
    if action_type == "set_view":
        return f"Click below to switch to {str(action.get('view')).upper()} view."
    if action_type == "set_zoom":
        return f"Click below to set zoom to {action.get('value')}."
    return "Click below to apply this action."


def parse_intent(message: str, available_organs: list[str], viewer_state: dict | None = None, case_id: str | None = None) -> dict[str, Any]:
    norm = _normalize(message)
    current_viewer_state = viewer_state or {}
    current_organs = available_organs or []
    if not norm:
        return {"reply": "Please type a question or viewer command.", "actions": [], "source": "hardcoded", "intent": "clarification_needed"}
    if _unsafe_medical_request(norm):
        return _unsafe_reply()
    actions = []
    case_action = _parse_case_data_question(norm)
    if case_action:
        actions.append(case_action)
    opacity_action = _parse_opacity(norm, current_viewer_state)
    if opacity_action:
        actions.append(opacity_action)
    actions.extend(_parse_window(norm, current_viewer_state))
    view_action = _parse_view(norm)
    if view_action:
        actions.append(view_action)
    zoom_action = _parse_zoom(norm, current_viewer_state)
    if zoom_action:
        actions.append(zoom_action)
    measurement_action = _parse_measurement(norm)
    if measurement_action:
        actions.append(measurement_action)
    actions.extend(_parse_organ_actions(norm, current_organs))
    education = _educational_answer(norm)
    deduped = []
    seen = set()
    for action in actions:
        key = repr(sorted(action.items()))
        if key not in seen:
            deduped.append(action)
            seen.add(key)
    valid_actions = [action for action in deduped if _validate_action(action, current_organs)]
    if education and valid_actions:
        reply = education + "\n\n" + " ".join(_action_label(action) for action in valid_actions)
        intent = "hybrid"
    elif education:
        reply = education
        intent = "educational_question"
    elif valid_actions:
        reply = " ".join(_action_label(action) for action in valid_actions)
        intent = "viewer_action"
    else:
        reply = "I did not recognize that yet. Try: “Only show the liver.” “What does the pancreas do?” “What is a CT scan?” “Set opacity to 50%.” “Enable ROI.” “Which structure is largest?” “List the structures present in this case.”"
        intent = "clarification_needed"
    return {"reply": reply, "actions": valid_actions, "source": "hardcoded", "intent": intent}

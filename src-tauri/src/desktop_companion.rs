use serde::Serialize;
use uiautomation::{
    clipboards::Clipboard,
    core::{UIAutomation, UIElement},
    types::ControlType,
};

#[derive(Serialize)]
pub struct CodexTargetStatus {
    pub found: bool,
    pub ready: bool,
    pub label: String,
    pub detail: String,
}

fn codex_window(automation: &UIAutomation) -> Result<UIElement, String> {
    let windows = automation
        .create_matcher()
        .control_type(ControlType::Window)
        .match_name("ChatGPT")
        .depth(3)
        .timeout(0)
        .find_all()
        .map_err(|_| "The Codex window is not open.".to_string())?;

    for window in windows {
        let is_codex = automation
            .create_matcher()
            .from(window.clone())
            .control_type(ControlType::Document)
            .match_name("Codex")
            .depth(8)
            .timeout(0)
            .find_first()
            .is_ok();
        if is_codex {
            return Ok(window);
        }
    }
    Err("A ChatGPT window is open, but it is not the Codex interface.".to_string())
}

fn codex_composer(automation: &UIAutomation, window: UIElement) -> Result<UIElement, String> {
    automation
        .create_matcher()
        .from(window)
        .control_type(ControlType::Group)
        .classname("ProseMirror")
        .depth(40)
        .timeout(0)
        .find_first()
        .map_err(|_| "Codex is open, but its message box is not ready yet.".to_string())
}

#[tauri::command]
pub fn codex_target_status() -> CodexTargetStatus {
    let result = UIAutomation::new()
        .map_err(|_| "Windows accessibility could not start.".to_string())
        .and_then(|automation| {
            let window = codex_window(&automation)?;
            codex_composer(&automation, window).map(|_| ())
        });
    match result {
        Ok(()) => CodexTargetStatus {
            found: true,
            ready: true,
            label: "Codex — current Windows task".to_string(),
            detail: "Codex is open and its message box is ready.".to_string(),
        },
        Err(detail) => CodexTargetStatus {
            found: !detail.contains("not open") && !detail.contains("not the Codex"),
            ready: false,
            label: "Codex — current Windows task".to_string(),
            detail,
        },
    }
}

#[tauri::command]
pub fn insert_codex_draft(draft: String) -> Result<(), String> {
    let draft = draft.trim();
    if draft.is_empty() {
        return Err("Say or type something first.".to_string());
    }
    let automation =
        UIAutomation::new().map_err(|_| "Windows accessibility could not start.".to_string())?;
    let window = codex_window(&automation)?;
    let composer = codex_composer(&automation, window)?;
    composer
        .send_keys("{ctrl}a", 0)
        .map_err(|_| "Codex's message box could not be selected.".to_string())?;
    composer
        .send_text_by_clipboard(draft)
        .map_err(|_| "The draft could not be inserted into Codex.".to_string())
}

#[tauri::command]
pub fn copy_latest_codex_response() -> Result<String, String> {
    let automation =
        UIAutomation::new().map_err(|_| "Windows accessibility could not start.".to_string())?;
    let window = codex_window(&automation)?;
    let copy_buttons = automation
        .create_matcher()
        .from(window)
        .control_type(ControlType::Button)
        .match_name("Copy")
        .depth(40)
        .timeout(0)
        .find_all()
        .map_err(|_| "No completed Codex response is available yet.".to_string())?;
    let copy = copy_buttons
        .last()
        .ok_or_else(|| "No completed Codex response is available yet.".to_string())?;
    copy.click()
        .map_err(|_| "The latest Codex response could not be copied.".to_string())?;
    std::thread::sleep(std::time::Duration::from_millis(150));
    let clipboard =
        Clipboard::open().map_err(|_| "Windows could not open the clipboard.".to_string())?;
    let text = clipboard
        .get_text()
        .map_err(|_| "The copied response could not be read.".to_string())?;
    if text.trim().is_empty() {
        Err("The copied Codex response was empty.".to_string())
    } else {
        Ok(text)
    }
}

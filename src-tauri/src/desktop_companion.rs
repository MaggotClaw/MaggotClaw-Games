use serde::Serialize;
use uiautomation::{
    clipboards::Clipboard,
    core::{UIAutomation, UIElement},
    patterns::UIInvokePattern,
    types::ControlType,
};
use windows::Win32::Foundation::HWND;
use windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow;

#[derive(Clone, Copy, PartialEq)]
enum Target {
    Claude,
    Codex,
}

impl Target {
    fn label(self) -> &'static str {
        match self {
            Target::Claude => "Claude — desktop app",
            Target::Codex => "Codex — current Windows task",
        }
    }

    fn short_name(self) -> &'static str {
        match self {
            Target::Claude => "Claude",
            Target::Codex => "Codex",
        }
    }

    // Matched as case-insensitive substrings: the apps rename these buttons
    // between versions ("Copy" → "Copy message" → "Copy response"), and an
    // exact match going stale left the companion waiting forever.
    fn copy_button_names(self) -> &'static [&'static str] {
        match self {
            Target::Claude => &["copy"],
            Target::Codex => &["copy"],
        }
    }

    fn stop_button_names(self) -> &'static [&'static str] {
        match self {
            Target::Claude => &["stop"],
            Target::Codex => &["stop"],
        }
    }
}

#[derive(Serialize)]
pub struct ConversationTargetStatus {
    pub found: bool,
    pub ready: bool,
    pub name: String,
    pub label: String,
    pub detail: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationResponseState {
    pub busy: bool,
    pub has_completed_response: bool,
    pub completed_response_count: usize,
}

fn automation() -> Result<UIAutomation, String> {
    UIAutomation::new()
        .or_else(|_| UIAutomation::new_direct())
        .map_err(|_| "Windows accessibility could not start.".to_string())
}

fn claude_window(automation: &UIAutomation) -> Result<UIElement, String> {
    let windows = automation
        .create_matcher()
        .control_type(ControlType::Window)
        .match_name("Claude")
        .depth(3)
        .timeout(0)
        .find_all()
        .map_err(|_| "The Claude desktop window is not open.".to_string())?;

    for window in windows {
        let has_prompt = automation
            .create_matcher()
            .from(window.clone())
            .control_type(ControlType::Group)
            .match_name("Prompt")
            .depth(40)
            .timeout(0)
            .find_first()
            .is_ok();
        if has_prompt {
            return Ok(window);
        }
    }
    Err("A Claude window is open, but its message box is not ready yet.".to_string())
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

fn resolve_target(
    automation: &UIAutomation,
    requested: Option<&str>,
) -> Result<(Target, UIElement), String> {
    match requested {
        Some("claude") => claude_window(automation).map(|window| (Target::Claude, window)),
        Some("codex") => codex_window(automation).map(|window| (Target::Codex, window)),
        _ => {
            if let Ok(window) = claude_window(automation) {
                return Ok((Target::Claude, window));
            }
            codex_window(automation)
                .map(|window| (Target::Codex, window))
                .map_err(|_| {
                    "Neither the Claude desktop app nor the Codex window is open.".to_string()
                })
        }
    }
}

fn composer(
    automation: &UIAutomation,
    target: Target,
    window: UIElement,
) -> Result<UIElement, String> {
    let matcher = automation
        .create_matcher()
        .from(window)
        .control_type(ControlType::Group)
        .depth(40)
        .timeout(0);
    let result = match target {
        Target::Claude => matcher.match_name("Prompt").find_first(),
        Target::Codex => matcher
            .filter_fn(Box::new(|element: &UIElement| {
                Ok(element
                    .get_classname()
                    .map(|name| name.split_whitespace().any(|part| part == "ProseMirror"))
                    .unwrap_or(false))
            }))
            .find_first(),
    };
    result.map_err(|_| {
        format!(
            "{} is open, but its message box is not ready yet.",
            target.short_name()
        )
    })
}

// How strictly a button name must match. Stop buttons match by prefix so a
// label like "Custom stop point" cannot fake a busy state; copy buttons match
// anywhere but never inside code blocks ("Copy code"), whose buttons would
// otherwise be mistaken for the reply's own Copy control.
fn matching_buttons(
    automation: &UIAutomation,
    window: UIElement,
    names: &[&str],
    prefix_only: bool,
    exclude: &[&str],
) -> Vec<UIElement> {
    automation
        .create_matcher()
        .from(window)
        .control_type(ControlType::Button)
        .depth(40)
        .timeout(0)
        .find_all()
        .map(|buttons| {
            buttons
                .into_iter()
                .filter(|button| {
                    button
                        .get_name()
                        .map(|name| {
                            let lower = name.to_ascii_lowercase();
                            if exclude.iter().any(|word| lower.contains(word)) {
                                return false;
                            }
                            names.iter().any(|candidate| {
                                if prefix_only {
                                    lower.starts_with(candidate)
                                } else {
                                    lower.contains(candidate)
                                }
                            })
                        })
                        .unwrap_or(false)
                })
                .collect()
        })
        .unwrap_or_default()
}

fn conversation_target_status_blocking(target: Option<String>) -> ConversationTargetStatus {
    let result = automation().and_then(|automation| {
        let (resolved, window) = resolve_target(&automation, target.as_deref())?;
        composer(&automation, resolved, window).map(|_| resolved)
    });
    match result {
        Ok(target) => ConversationTargetStatus {
            found: true,
            ready: true,
            name: target.short_name().to_string(),
            label: target.label().to_string(),
            detail: format!(
                "{} is open and its message box is ready.",
                target.short_name()
            ),
        },
        Err(detail) => ConversationTargetStatus {
            found: detail.contains(" is open"),
            ready: false,
            name: String::new(),
            label: "Claude or Codex".to_string(),
            detail,
        },
    }
}

fn insert_conversation_draft_blocking(draft: String, target: Option<String>) -> Result<(), String> {
    let draft = draft.trim();
    if draft.is_empty() {
        return Err("Say or type something first.".to_string());
    }
    let automation = automation()?;
    let (target, window) = resolve_target(&automation, target.as_deref())?;
    let composer = composer(&automation, target, window)?;
    composer.send_keys("{ctrl}a", 0).map_err(|_| {
        format!(
            "{}'s message box could not be selected.",
            target.short_name()
        )
    })?;
    composer.send_text_by_clipboard(draft).map_err(|_| {
        format!(
            "The draft could not be inserted into {}.",
            target.short_name()
        )
    })
}

fn clear_conversation_draft_blocking(target: Option<String>) -> Result<(), String> {
    let automation = automation()?;
    let (target, window) = resolve_target(&automation, target.as_deref())?;
    let composer = composer(&automation, target, window)?;
    composer.send_keys("{ctrl}a{backspace}", 0).map_err(|_| {
        format!(
            "The unsent {} message could not be cleared.",
            target.short_name()
        )
    })
}

fn send_conversation_message_blocking(draft: String, target: Option<String>) -> Result<(), String> {
    insert_conversation_draft_blocking(draft, target.clone())?;
    let automation = automation()?;
    let (target, window) = resolve_target(&automation, target.as_deref())?;
    let composer = composer(&automation, target, window)?;
    composer.send_keys("{enter}", 0).map_err(|_| {
        format!(
            "The draft is in {}, but Windows could not press Send.",
            target.short_name()
        )
    })
}

fn conversation_response_state_blocking(
    target: Option<String>,
) -> Result<ConversationResponseState, String> {
    let automation = automation()?;
    let (target, window) = resolve_target(&automation, target.as_deref())?;
    let busy = !matching_buttons(
        &automation,
        window.clone(),
        target.stop_button_names(),
        true,
        &[],
    )
    .is_empty();
    let completed_response_count = matching_buttons(
        &automation,
        window,
        target.copy_button_names(),
        false,
        &["code"],
    )
    .len();
    Ok(ConversationResponseState {
        busy,
        has_completed_response: completed_response_count > 0,
        completed_response_count,
    })
}

fn conversation_is_foreground_blocking(target: Option<String>) -> Result<bool, String> {
    let automation = automation()?;
    let (target, window) = resolve_target(&automation, target.as_deref())?;
    let handle: HWND = window
        .get_native_window_handle()
        .map_err(|_| format!("{}'s Windows handle is unavailable.", target.short_name()))?
        .into();
    Ok(unsafe { GetForegroundWindow() } == handle)
}

fn copy_latest_conversation_response_blocking(target: Option<String>) -> Result<String, String> {
    let automation = automation()?;
    let (target, window) = resolve_target(&automation, target.as_deref())?;
    let window_left = window
        .get_bounding_rectangle()
        .ok()
        .map(|rect| (rect.get_left(), rect.get_width()));
    let copy_buttons = matching_buttons(
        &automation,
        window,
        target.copy_button_names(),
        false,
        &["code"],
    );
    // The author's own messages sit to the right, the assistant's to the left.
    // Reading position is the only reliable way to tell them apart: comparing
    // the copied text against what was just sent fails the moment the window
    // renders it back with different punctuation or spacing, and then the app
    // reads his own words to him as though they were the answer.
    let assistant_side: Vec<&UIElement> = window_left
        .map(|(left, width)| {
            let midpoint = left + width / 2;
            copy_buttons
                .iter()
                .filter(|button| {
                    button
                        .get_bounding_rectangle()
                        .map(|rect| rect.get_left() < midpoint)
                        .unwrap_or(true)
                })
                .collect()
        })
        // No window bounds means no way to judge sides; better every button
        // than none, since the old behaviour at least usually worked.
        .unwrap_or_else(|| copy_buttons.iter().collect());
    let copy = assistant_side.last().copied().ok_or_else(|| {
        format!(
            "No completed {} response is available yet.",
            target.short_name()
        )
    })?;
    copy.get_pattern::<UIInvokePattern>()
        .and_then(|pattern| pattern.invoke())
        .map_err(|_| {
            format!(
                "The latest {} response could not be copied.",
                target.short_name()
            )
        })?;
    std::thread::sleep(std::time::Duration::from_millis(150));
    let clipboard =
        Clipboard::open().map_err(|_| "Windows could not open the clipboard.".to_string())?;
    let text = clipboard
        .get_text()
        .map_err(|_| "The copied response could not be read.".to_string())?;
    if text.trim().is_empty() {
        Err(format!(
            "The copied {} response was empty.",
            target.short_name()
        ))
    } else {
        Ok(text)
    }
}

fn background_error() -> String {
    "Windows accessibility stopped unexpectedly. Please try again.".to_string()
}

#[tauri::command]
pub async fn conversation_target_status(target: Option<String>) -> ConversationTargetStatus {
    tauri::async_runtime::spawn_blocking(move || conversation_target_status_blocking(target))
        .await
        .unwrap_or_else(|_| ConversationTargetStatus {
            found: false,
            ready: false,
            name: String::new(),
            label: "Claude or Codex".to_string(),
            detail: background_error(),
        })
}

#[tauri::command]
pub async fn insert_conversation_draft(
    draft: String,
    target: Option<String>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || insert_conversation_draft_blocking(draft, target))
        .await
        .map_err(|_| background_error())?
}

#[tauri::command]
pub async fn clear_conversation_draft(target: Option<String>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || clear_conversation_draft_blocking(target))
        .await
        .map_err(|_| background_error())?
}

#[tauri::command]
pub async fn send_conversation_message(
    draft: String,
    target: Option<String>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || send_conversation_message_blocking(draft, target))
        .await
        .map_err(|_| background_error())?
}

#[tauri::command]
pub async fn conversation_response_state(
    target: Option<String>,
) -> Result<ConversationResponseState, String> {
    tauri::async_runtime::spawn_blocking(move || conversation_response_state_blocking(target))
        .await
        .map_err(|_| background_error())?
}

#[tauri::command]
pub async fn conversation_is_foreground(target: Option<String>) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || conversation_is_foreground_blocking(target))
        .await
        .map_err(|_| background_error())?
}

#[tauri::command]
pub async fn copy_latest_conversation_response(target: Option<String>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || copy_latest_conversation_response_blocking(target))
        .await
        .map_err(|_| background_error())?
}

/// Looks at what the assistant's window is actually made of, and reports it.
///
/// Reading a reply while it is still arriving means taking the text straight
/// from the window rather than waiting for a Copy button that only appears when
/// the message is finished. Whether that is possible depends on how the window
/// exposes its text, which cannot be known without looking at a real one —
/// guessing would mean an app that quietly reads the wrong thing.
///
/// Read-only. It clicks nothing and changes nothing.
#[tauri::command]
pub async fn inspect_conversation_text(target: Option<String>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || inspect_conversation_text_blocking(target))
        .await
        .map_err(|_| background_error())?
}

fn inspect_conversation_text_blocking(target: Option<String>) -> Result<String, String> {
    let automation = automation()?;
    let (target, window) = resolve_target(&automation, target.as_deref())?;
    let bounds = window
        .get_bounding_rectangle()
        .map_err(|_| "The window's position could not be read.".to_string())?;
    let midpoint = bounds.get_left() + bounds.get_width() / 2;

    let mut report = format!(
        "{} window — {} wide, midpoint at {}\n\n",
        target.short_name(),
        bounds.get_width(),
        midpoint
    );

    for (label, control) in [
        ("Text", ControlType::Text),
        ("Document", ControlType::Document),
        ("Group", ControlType::Group),
        ("Edit", ControlType::Edit),
    ] {
        let found = automation
            .create_matcher()
            .from(window.clone())
            .control_type(control)
            .depth(40)
            .timeout(0)
            .find_all()
            .unwrap_or_default();
        // Only elements carrying real prose are interesting; a window is full
        // of empty containers and one-word labels.
        let mut carrying: Vec<(i32, usize, String)> = found
            .iter()
            .filter_map(|element| {
                let name = element.get_name().ok()?;
                let trimmed = name.trim();
                if trimmed.len() < 40 {
                    return None;
                }
                let left = element.get_bounding_rectangle().ok()?.get_left();
                Some((left, trimmed.chars().count(), trimmed.chars().take(70).collect()))
            })
            .collect();
        carrying.sort_by_key(|(left, _, _)| *left);
        report.push_str(&format!(
            "{label}: {} found, {} carrying text\n",
            found.len(),
            carrying.len()
        ));
        for (left, length, sample) in carrying.iter().take(6) {
            let side = if *left < midpoint { "LEFT (assistant)" } else { "RIGHT (yours)" };
            report.push_str(&format!("   x={left:<6} {length:>6} chars  {side}  {sample}…\n"));
        }
        report.push('\n');
    }
    Ok(report)
}

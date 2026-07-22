use serde::Serialize;
use uiautomation::{
    clipboards::Clipboard,
    core::{UIAutomation, UIElement},
    patterns::{UIInvokePattern, UIValuePattern},
    types::ControlType,
};
use std::{fs::OpenOptions, io::Write, path::PathBuf};
use windows::Win32::Foundation::HWND;
use windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow;

fn log_path() -> PathBuf {
    std::env::temp_dir().join("maggotclaw-companion-debug.log")
}

fn type_via_powershell(text: &str) -> Result<(), String> {
    let escaped = text.replace("'", "''");
    let ps_script = format!(
        r#"Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32 {{
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}}
"@
Add-Type -AssemblyName UIAutomationClient
$root = [System.Windows.Automation.AutomationElement]::RootElement
$ide = $root.FindFirst([System.Windows.Automation.TreeScope]::Children, (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, "MaggotClaw Games - Antigravity IDE")))
$hwndProp = $ide.GetCurrentPropertyValue([System.Windows.Automation.AutomationElement]::NativeWindowHandleProperty)
$hwnd = [IntPtr]$hwndProp
if ($hwnd -ne [IntPtr]::Zero) {{
    [Win32]::ShowWindow($hwnd, 9)
    [Win32]::BringWindowToTop($hwnd)
    [Win32]::SetForegroundWindow($hwnd)
    Start-Sleep -Milliseconds 300
}}
$edits = $ide.FindAll([System.Windows.Automation.TreeScope]::Descendants, (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Edit)))
foreach ($e in $edits) {{
    if ($e.Current.Name -match "Type a message") {{
        $e.SetFocus()
        Start-Sleep -Milliseconds 300
        [System.Windows.Forms.SendKeys]::SendWait("^a")
        Start-Sleep -Milliseconds 100
        [System.Windows.Forms.SendKeys]::SendWait("{{DEL}}")
        Start-Sleep -Milliseconds 200
        [System.Windows.Forms.SendKeys]::SendWait('{0}')
        Start-Sleep -Milliseconds 500
        break
    }}
}}
"#,
        escaped
    );
    let output = std::process::Command::new("powershell")
        .args(["-NoProfile", "-Command", &ps_script])
        .output()
        .map_err(|e| format!("Failed to launch PowerShell: {}", e))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("PowerShell failed: {}", stderr));
    }
    Ok(())
}

fn log(msg: &str) {
    if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(log_path()) {
        let _ = writeln!(f, "{}", msg);
    }
}

#[derive(Clone, Copy, PartialEq)]
enum Target {
    Claude,
    Codex,
    Antigravity,
}

impl Target {
    fn label(self) -> &'static str {
        match self {
            Target::Claude => "Claude — desktop app",
            Target::Codex => "Codex — current Windows task",
            Target::Antigravity => "Antigravity IDE — current Windows task",
        }
    }

    fn short_name(self) -> &'static str {
        match self {
            Target::Claude => "Claude",
            Target::Codex => "Codex",
            Target::Antigravity => "Antigravity",
        }
    }

    fn copy_button_names(self) -> &'static [&'static str] {
        match self {
            Target::Claude => &["copy"],
            Target::Codex => &["copy"],
            Target::Antigravity => &["copy response", "copy"],
        }
    }

    fn stop_button_names(self) -> &'static [&'static str] {
        match self {
            Target::Claude => &["stop"],
            Target::Codex => &["stop"],
            Target::Antigravity => &["stop"],
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

/// The program a window belongs to.
///
/// Two entirely different programs put a window on screen called "Claude" —
/// the chat app and Claude Code — so the title cannot tell them apart. Asking
/// Windows for a window named "Claude" returns whichever one it happens to
/// hand back, and it does not always hand back the same one. That is why the
/// companion sometimes talked to the wrong program and read the author's own
/// words back to him: in Claude Code every message sits on the left, so the
/// left-is-the-assistant rule finds his own text and believes it.
fn window_executable(window: &UIElement) -> Option<String> {
    use windows::Win32::Foundation::{CloseHandle, MAX_PATH};
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_FORMAT, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows::Win32::UI::WindowsAndMessaging::GetWindowThreadProcessId;

    let handle: HWND = window.get_native_window_handle().ok()?.into();
    let mut pid: u32 = 0;
    unsafe { GetWindowThreadProcessId(handle, Some(&mut pid)) };
    if pid == 0 {
        return None;
    }
    unsafe {
        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut buffer = [0u16; MAX_PATH as usize];
        let mut length = buffer.len() as u32;
        let ok = QueryFullProcessImageNameW(
            process,
            PROCESS_NAME_FORMAT(0),
            windows::core::PWSTR(buffer.as_mut_ptr()),
            &mut length,
        );
        let _ = CloseHandle(process);
        ok.ok()?;
        Some(String::from_utf16_lossy(&buffer[..length as usize]))
    }
}

/// The Claude chat app installs through the Microsoft Store, so its program
/// lives under WindowsApps. Claude Code does not.
fn is_chat_app(window: &UIElement) -> bool {
    window_executable(window)
        .map(|path| {
            let lower = path.to_lowercase();
            lower.contains("windowsapps") && lower.ends_with("claude.exe")
        })
        .unwrap_or(false)
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

    // The message box, which is a Group rather than a text field — asking for
    // an Edit control finds nothing at all in this app.
    let ready = |window: &UIElement| {
        automation
            .create_matcher()
            .from(window.clone())
            .control_type(ControlType::Group)
            .match_name("Prompt")
            .depth(40)
            .timeout(0)
            .find_first()
            .is_ok()
    };

    // The chat app wins outright, whatever else is on screen.
    if let Some(window) = windows.iter().find(|window| is_chat_app(window) && ready(window)) {
        return Ok(window.clone());
    }
    if windows.iter().any(is_chat_app) {
        return Err("The Claude chat app is open, but its message box is not ready yet.".to_string());
    }
    // No chat app running. Rather than silently drive Claude Code — which
    // looks similar and reads back wrong — say which program is missing.
    if windows.is_empty() {
        return Err("The Claude chat app is not open.".to_string());
    }
    Err("A window called Claude is open, but it is not the Claude chat app — \
         open the Claude desktop app and try again."
        .to_string())
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

fn antigravity_window(automation: &UIAutomation) -> Result<UIElement, String> {
    let windows = automation
        .create_matcher()
        .control_type(ControlType::Window)
        .filter_fn(Box::new(|element: &UIElement| {
            Ok(element
                .get_name()
                .map(|name| name.starts_with("MaggotClaw Games - Antigravity IDE"))
                .unwrap_or(false))
        }))
        .depth(3)
        .timeout(0)
        .find_all()
        .map_err(|_| "The Antigravity IDE window is not open.".to_string())?;

    if windows.is_empty() {
        return Err("The Antigravity IDE window is not open.".to_string());
    }

    Ok(windows.into_iter().next().unwrap())
}

fn foreground_executable() -> Option<String> {
    use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId};
    use windows::Win32::System::Threading::{OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_FORMAT, PROCESS_QUERY_LIMITED_INFORMATION};
    use windows::Win32::Foundation::{CloseHandle, MAX_PATH};

    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.is_invalid() { return None; }

        let mut pid: u32 = 0;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        if pid == 0 { return None; }

        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut buffer = [0u16; MAX_PATH as usize];
        let mut length = buffer.len() as u32;
        let ok = QueryFullProcessImageNameW(
            process,
            PROCESS_NAME_FORMAT(0),
            windows::core::PWSTR(buffer.as_mut_ptr()),
            &mut length,
        );
        let _ = CloseHandle(process);
        ok.ok()?;
        Some(String::from_utf16_lossy(&buffer[..length as usize]))
    }
}

fn current_window(automation: &UIAutomation) -> Result<(Target, UIElement), String> {
    let exe = foreground_executable()
        .map(|s| s.to_lowercase())
        .unwrap_or_default();

    if exe.contains("claude") {
        let window = claude_window(automation)?;
        return Ok((Target::Claude, window));
    }
    if exe.contains("antigravity") {
        let window = antigravity_window(automation)?;
        return Ok((Target::Antigravity, window));
    }
    if exe.contains("chatgpt") || exe.contains("openai") {
        let window = codex_window(automation)?;
        return Ok((Target::Codex, window));
    }

    Err("The current window is not Claude, Antigravity IDE, or Codex.".to_string())
}

fn resolve_target(
    automation: &UIAutomation,
    requested: Option<&str>,
) -> Result<(Target, UIElement), String> {
    log(&format!("resolve_target requested={:?}", requested));
    match requested {
        Some("claude") => claude_window(automation).map(|window| (Target::Claude, window)),
        Some("codex") => codex_window(automation).map(|window| (Target::Codex, window)),
        Some("antigravity") => antigravity_window(automation).map(|window| (Target::Antigravity, window)),
        Some("current") => current_window(automation),
        _ => {
            if let Ok(window) = claude_window(automation) {
                return Ok((Target::Claude, window));
            }
            if let Ok(window) = antigravity_window(automation) {
                return Ok((Target::Antigravity, window));
            }
            codex_window(automation)
                .map(|window| (Target::Codex, window))
                .map_err(|_| {
                    "Neither the Claude desktop app, Antigravity IDE, nor the Codex window is open.".to_string()
                })
        }
    }
}

fn composer(
    automation: &UIAutomation,
    target: Target,
    window: UIElement,
) -> Result<UIElement, String> {
    log(&format!("composer target={:?}", target.short_name()));
    let result = match target {
        Target::Claude => automation
            .create_matcher()
            .from(window.clone())
            .control_type(ControlType::Group)
            .match_name("Prompt")
            .depth(40)
            .timeout(0)
            .find_first(),
        Target::Codex => automation
            .create_matcher()
            .from(window.clone())
            .control_type(ControlType::Group)
            .filter_fn(Box::new(|element: &UIElement| {
                Ok(element
                    .get_classname()
                    .map(|name| name.split_whitespace().any(|part| part == "ProseMirror"))
                    .unwrap_or(false))
            }))
            .depth(40)
            .timeout(0)
            .find_first(),
        Target::Antigravity => {
            log("antigravity matcher: searching Edit control");
            let r = automation
                .create_matcher()
                .from(window)
                .control_type(ControlType::Edit)
                .filter_fn(Box::new(|element: &UIElement| {
                    Ok(element
                        .get_classname()
                        .map(|name| name == "prompt-input")
                        .unwrap_or(false)
                        || element
                            .get_name()
                            .map(|name| name.contains("Type a message..."))
                            .unwrap_or(false))
                }))
                .depth(40)
                .timeout(0)
                .find_first();
            if let Err(ref err) = r {
                log(&format!("antigravity matcher failed: {:?}", err));
            }
            log(&format!("antigravity matcher result: {:?}", r.is_ok()));
            r
        }
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
    let found = automation
        .create_matcher()
        .from(window)
        .control_type(ControlType::Button)
        .depth(40)
        .timeout(0)
        .find_all()
        .unwrap_or_default();
    log(&format!("matching_buttons names={:?} prefix_only={} exclude={:?} found={}", names, prefix_only, exclude, found.len()));
    found
        .into_iter()
        .filter(|button| {
            let name = button.get_name().unwrap_or_default();
            let lower = name.to_ascii_lowercase();
            let excluded = exclude.iter().any(|word| lower.contains(word));
            let matched = !excluded && names.iter().any(|candidate| {
                if prefix_only {
                    lower.starts_with(candidate)
                } else {
                    lower.contains(candidate)
                }
            });
            if matched {
                log(&format!("button matched name='{}'", name));
            }
            matched
        })
        .collect()
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
            label: "Claude, Codex, or Antigravity IDE".to_string(),
            detail,
        },
    }
}

fn insert_conversation_draft_blocking(draft: String, target: Option<String>) -> Result<(), String> {
    log(&format!("insert_draft start len={}", draft.len()));
    let draft = draft.trim();
    if draft.is_empty() {
        return Err("Say or type something first.".to_string());
    }
    let automation = automation()?;
    let (target, window) = resolve_target(&automation, target.as_deref())?;
    let composer = composer(&automation, target.clone(), window.clone())?;

    composer.set_focus().map_err(|_| {
        format!(
            "The draft could not be focused in {}.",
            target.short_name()
        )
    })?;
    std::thread::sleep(std::time::Duration::from_millis(150));

    let selected = composer.send_keys("{ctrl}a", 0).is_ok();
    log(&format!("insert_draft select_all ok={}", selected));
    std::thread::sleep(std::time::Duration::from_millis(80));

    type_via_powershell(draft).map_err(|e| {
        format!("The draft could not be typed into {}: {}", target.short_name(), e)
    })?;

    std::thread::sleep(std::time::Duration::from_millis(150));

    if let Ok(value_pattern) = composer.get_pattern::<UIValuePattern>() {
        let current = value_pattern.get_value().unwrap_or_default();
        log(&format!("insert_draft value after powershell type='{}'", current));
        if current.is_empty() {
            log("insert_draft powershell type verification failed");
        }
    }

    Ok(())
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
    log("send_message start");
    insert_conversation_draft_blocking(draft, target.clone())?;
    std::thread::sleep(std::time::Duration::from_millis(400));
    let automation = automation()?;
    let (target, window) = resolve_target(&automation, target.as_deref())?;
    let composer = composer(&automation, target.clone(), window.clone())?;
    composer.set_focus().map_err(|_| {
        format!(
            "The draft is in {}, but Windows could not focus the input.",
            target.short_name()
        )
    })?;
    std::thread::sleep(std::time::Duration::from_millis(120));
    match target {
        Target::Antigravity => {
            let send_buttons = matching_buttons(
                &automation,
                window,
                &["send"],
                false,
                &[],
            );
            if let Some(button) = send_buttons.into_iter().next() {
                log("antigravity send: clicking Send button");
                button.get_pattern::<UIInvokePattern>()
                    .and_then(|pattern| pattern.invoke())
                    .map_err(|_| "The Send button could not be clicked.".to_string())
            } else {
                log("antigravity send: Send button not found, falling back to Enter");
                composer.send_keys("{enter}", 0).map_err(|_| {
                    "The draft is in Antigravity, but Windows could not press Send.".to_string()
                })
            }
        }
        _ => composer.send_keys("{enter}", 0).map_err(|_| {
            format!(
                "The draft is in {}, but Windows could not press Send.",
                target.short_name()
            )
        }),
    }
}

fn conversation_response_state_blocking(
    target: Option<String>,
) -> Result<ConversationResponseState, String> {
    log(&format!("response_state target={:?}", target));
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
    log(&format!("copy_response target={:?}", target));
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

/// The reply as it stands right now, mid-flight.
///
/// Measured against the real app rather than guessed at: while an answer
/// arrives, the number of text elements climbs (46 to 102 across one reply)
/// and then collapses once it finishes. Claude adds many small elements one
/// after another — it does not grow a single one — so the reply is read by
/// gathering every assistant-side element in order, not by watching one box
/// get longer.
///
/// Only the newest run is returned. Everything above it is the rest of the
/// conversation, which was read long ago.
fn streaming_reply_blocking(target: Option<String>) -> Result<String, String> {
    let automation = automation()?;
    let (_, window) = resolve_target(&automation, target.as_deref())?;
    let bounds = window
        .get_bounding_rectangle()
        .map_err(|_| "The window's position could not be read.".to_string())?;
    let midpoint = bounds.get_left() + bounds.get_width() / 2;

    let found = automation
        .create_matcher()
        .from(window)
        .control_type(ControlType::Text)
        .depth(40)
        .timeout(0)
        .find_all()
        .unwrap_or_default();

    // Reading order is top to bottom, then left to right — the order the eye
    // takes them in, which is the order they were written in.
    let mut pieces: Vec<(i32, i32, String)> = found
        .iter()
        .filter_map(|element| {
            let name = element.get_name().ok()?;
            let text = name.trim();
            if text.is_empty() {
                return None;
            }
            let rect = element.get_bounding_rectangle().ok()?;
            // The author's own messages sit to the right. Reading those aloud
            // as though they were the answer is the exact failure this guards.
            if rect.get_left() >= midpoint {
                return None;
            }
            Some((rect.get_top(), rect.get_left(), text.to_string()))
        })
        .collect();
    pieces.sort_by_key(|(top, left, _)| (*top, *left));

    Ok(pieces
        .into_iter()
        .map(|(_, _, text)| text)
        .collect::<Vec<_>>()
        .join(" "))
}

#[tauri::command]
pub async fn streaming_reply(target: Option<String>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || streaming_reply_blocking(target))
        .await
        .map_err(|_| background_error())?
}

fn background_error() -> String {
    "Windows accessibility stopped unexpectedly. Please try again.".to_string()
}

// Where the two reading checks are handed over. Deliberately beside the
// project folders rather than inside one: this is a note about the program,
// not about the book, and filing it under a project would put it in the
// sync queue.
fn reading_check_path() -> Result<std::path::PathBuf, String> {
    let profile = std::env::var_os("USERPROFILE")
        .map(std::path::PathBuf::from)
        .ok_or_else(|| "Windows could not locate your user folder.".to_string())?;
    Ok(profile
        .join("Documents")
        .join("MaggotClaw Games")
        .join("Reading Check.txt"))
}

#[tauri::command]
pub fn save_reading_check(first: String, second: String) -> Result<String, String> {
    let path = reading_check_path()?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|_| "That folder could not be created.".to_string())?;
    }
    let section = |label: &str, body: &str| {
        if body.trim().is_empty() {
            format!("== {label} ==\n(not taken)\n\n")
        } else {
            format!("== {label} ==\n{}\n\n", body.trim())
        }
    };
    let text = format!(
        "MaggotClaw Games — Reading Check\n\n{}{}",
        section("First Look", &first),
        section("Second Look", &second)
    );
    std::fs::write(&path, text)
        .map_err(|_| "That file could not be written. Nothing was changed.".to_string())?;
    Ok(path.to_string_lossy().to_string())
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

fn debug_list_windows_blocking() -> Result<Vec<String>, String> {
    let automation = automation()?;
    let windows = automation
        .create_matcher()
        .control_type(ControlType::Window)
        .depth(3)
        .timeout(0)
        .find_all()
        .map_err(|_| "Could not enumerate windows.".to_string())?;

    let mut lines = vec!["=== TOP-LEVEL WINDOWS ===".to_string()];
    for window in windows.iter().take(80) {
        let name = window.get_name().unwrap_or_default();
        let class = window.get_classname().unwrap_or_default();
        let exe = window_executable(window)
            .map(|p| {
                let lower = p.to_lowercase();
                if let Some(idx) = lower.rfind('\\') {
                    p[(idx + 1)..].to_string()
                } else {
                    p
                }
            })
            .unwrap_or_default();
        lines.push(format!("{name}\tclass={class}\texe={exe}"));
    }
    lines.push(format!("{} windows found", windows.len()));
    Ok(lines)
}

fn debug_window_tree_blocking(partial_title: String) -> Result<Vec<String>, String> {
    let automation = automation()?;
    let lower_title = partial_title.to_lowercase();

    let windows = automation
        .create_matcher()
        .control_type(ControlType::Window)
        .depth(3)
        .timeout(0)
        .find_all()
        .map_err(|_| "Could not enumerate windows.".to_string())?;

    let target = windows.iter().find(|w| {
        w.get_name()
            .map(|n| n.to_lowercase().contains(&lower_title))
            .unwrap_or(false)
    }).ok_or_else(|| format!("No window found matching: {partial_title}"))?;

    let mut lines = vec![
        format!("=== WINDOW: {} ===", target.get_name().unwrap_or_default()),
        format!("class: {}", target.get_classname().unwrap_or_default()),
        format!("exe: {}", window_executable(target).unwrap_or_default()),
        "".to_string(),
    ];

    fn walk(prefix: &str, element: &UIElement, lines: &mut Vec<String>, depth: usize) {
        if depth > 5 { return; }
        let name = element.get_name().unwrap_or_default();
        let class = element.get_classname().unwrap_or_default();
        let ctype = format!("{:?}", element.get_control_type().unwrap_or(ControlType::Text));
        lines.push(format!("{prefix}{ctype} | {class} | {name}"));
    }

    walk("", target, &mut lines, 0);
    Ok(lines)
}

fn debug_find_input_blocking(partial_title: String) -> Result<Vec<String>, String> {
    let automation = automation()?;
    let lower_title = partial_title.to_lowercase();

    let windows = automation
        .create_matcher()
        .control_type(ControlType::Window)
        .depth(3)
        .timeout(0)
        .find_all()
        .map_err(|_| "Could not enumerate windows.".to_string())?;

    let target = windows.iter().find(|w| {
        w.get_name()
            .map(|n| n.to_lowercase().contains(&lower_title))
            .unwrap_or(false)
    }).ok_or_else(|| format!("No window found matching: {partial_title}"))?;

    let mut lines = vec![
        format!("=== INPUT SEARCH: {} ===", target.get_name().unwrap_or_default()),
        "".to_string(),
    ];

    for (label, control) in [
        ("Edit", ControlType::Edit),
        ("Document", ControlType::Document),
        ("Group", ControlType::Group),
        ("Custom", ControlType::Custom),
    ] {
        let found = automation
            .create_matcher()
            .from(target.clone())
            .control_type(control)
            .depth(40)
            .timeout(0)
            .find_all()
            .unwrap_or_default();
        lines.push(format!("{label}: {} found", found.len()));
        for el in found.iter().take(10) {
            let name = el.get_name().unwrap_or_default();
            let class = el.get_classname().unwrap_or_default();
            lines.push(format!("   name=\"{name}\" class={class}"));
        }
    }
    Ok(lines)
}

fn debug_find_buttons_blocking(
    partial_title: String,
    name_contains: String,
) -> Result<Vec<String>, String> {
    let automation = automation()?;
    let lower_title = partial_title.to_lowercase();
    let lower_name = name_contains.to_lowercase();

    let windows = automation
        .create_matcher()
        .control_type(ControlType::Window)
        .depth(3)
        .timeout(0)
        .find_all()
        .map_err(|_| "Could not enumerate windows.".to_string())?;

    let target = windows.iter().find(|w| {
        w.get_name()
            .map(|n| n.to_lowercase().contains(&lower_title))
            .unwrap_or(false)
    }).ok_or_else(|| format!("No window found matching: {partial_title}"))?;

    let mut lines = vec![
        format!("=== BUTTON SEARCH: {} (containing \"{}\") ===", target.get_name().unwrap_or_default(), name_contains),
        "".to_string(),
    ];

    let found = automation
        .create_matcher()
        .from(target.clone())
        .control_type(ControlType::Button)
        .depth(40)
        .timeout(0)
        .find_all()
        .unwrap_or_default();

    lines.push(format!("{} buttons found", found.len()));
    for el in found.iter() {
        let name = el.get_name().unwrap_or_default();
        if name.to_lowercase().contains(&lower_name) {
            let class = el.get_classname().unwrap_or_default();
            let rect = el.get_bounding_rectangle().ok();
            let pos = rect.map(|r| format!("x={} y={}", r.get_left(), r.get_top())).unwrap_or_default();
            lines.push(format!("   MATCH name=\"{name}\" class={class} {pos}"));
        }
    }
    Ok(lines)
}

#[tauri::command]
pub async fn debug_list_windows() -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(debug_list_windows_blocking)
        .await
        .map_err(|_| "Background task failed.".to_string())?
}

#[tauri::command]
pub async fn debug_window_tree(partial_title: String) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || debug_window_tree_blocking(partial_title))
        .await
        .map_err(|_| "Background task failed.".to_string())?
}

#[tauri::command]
pub async fn debug_find_input(partial_title: String) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || debug_find_input_blocking(partial_title))
        .await
        .map_err(|_| "Background task failed.".to_string())?
}

#[tauri::command]
pub async fn debug_find_buttons(
    partial_title: String,
    name_contains: String,
) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || debug_find_buttons_blocking(partial_title, name_contains))
        .await
        .map_err(|_| "Background task failed.".to_string())?
}

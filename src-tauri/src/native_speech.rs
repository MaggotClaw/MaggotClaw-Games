use serde::{Deserialize, Serialize};
use std::{
    io::{BufRead, BufReader, Write},
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::{mpsc, Mutex, OnceLock},
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

const CREATE_NO_WINDOW: u32 = 0x0800_0000;

struct DictationProcess {
    child: Child,
    controls: mpsc::Receiver<HelperControl>,
}

enum HelperControl {
    Ready,
    Listening,
    Stopped,
    Error(String),
    Closed,
}

static DICTATION_PROCESS: OnceLock<Mutex<Option<DictationProcess>>> = OnceLock::new();

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeSpeechEvent {
    text: String,
    is_final: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct HelperMessage {
    #[serde(rename = "type")]
    kind: String,
    text: Option<String>,
    is_final: Option<bool>,
    message: Option<String>,
}

fn dictation_process() -> &'static Mutex<Option<DictationProcess>> {
    DICTATION_PROCESS.get_or_init(|| Mutex::new(None))
}

fn helper_path(app: &AppHandle) -> Result<PathBuf, String> {
    let mut candidates = Vec::new();
    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join("resources").join("WindowsDictation.exe"));
        candidates.push(resource_dir.join("WindowsDictation.exe"));
    }
    candidates.push(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join("WindowsDictation.exe"),
    );
    candidates
        .into_iter()
        .find(|path| path.is_file())
        .ok_or_else(|| {
            "The free offline Windows speech engine is missing from this installation.".to_string()
        })
}

fn write_command(process: &mut DictationProcess, command: &str) -> Result<(), String> {
    let stdin = process.child.stdin.as_mut().ok_or_else(|| {
        "The offline Windows speech engine is not accepting commands.".to_string()
    })?;
    stdin
        .write_all(format!("{command}\n").as_bytes())
        .and_then(|_| stdin.flush())
        .map_err(|_| "The offline Windows speech engine stopped responding.".to_string())
}

fn wait_for_control(
    process: &mut DictationProcess,
    expected: fn(&HelperControl) -> bool,
    timeout: Duration,
) -> Result<(), String> {
    let started = std::time::Instant::now();
    while started.elapsed() < timeout {
        let remaining = timeout.saturating_sub(started.elapsed());
        match process.controls.recv_timeout(remaining) {
            Ok(control) if expected(&control) => return Ok(()),
            Ok(HelperControl::Error(error)) => return Err(error),
            Ok(HelperControl::Closed) => {
                return Err("The offline Windows speech engine closed unexpectedly.".to_string())
            }
            Ok(_) => {}
            Err(_) => break,
        }
    }
    Err("The offline Windows speech engine took too long to respond.".to_string())
}

fn spawn_helper(app: &AppHandle) -> Result<DictationProcess, String> {
    let helper = helper_path(app)?;
    let mut command = Command::new(helper);
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    let mut child = command.spawn().map_err(|error| {
        format!("The free offline Windows speech engine could not start: {error}")
    })?;
    let stdout = child.stdout.take().ok_or_else(|| {
        "The offline Windows speech engine did not provide a response.".to_string()
    })?;
    let (control_tx, control_rx) = mpsc::channel();
    let event_app = app.clone();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            let Ok(line) = line else { break };
            let Ok(message) = serde_json::from_str::<HelperMessage>(&line) else {
                continue;
            };
            match message.kind.as_str() {
                "ready" => {
                    let _ = control_tx.send(HelperControl::Ready);
                }
                "listening" => {
                    let _ = control_tx.send(HelperControl::Listening);
                }
                "stopped" => {
                    let _ = control_tx.send(HelperControl::Stopped);
                }
                "speech" => {
                    if let Some(text) = message.text.filter(|text| !text.trim().is_empty()) {
                        let _ = event_app.emit(
                            "native-speech",
                            NativeSpeechEvent {
                                text,
                                is_final: message.is_final.unwrap_or(false),
                            },
                        );
                    }
                }
                "notice" => {
                    if let Some(text) = message.message {
                        let _ = event_app.emit("native-speech-notice", text);
                    }
                }
                "error" => {
                    let text = message.message.unwrap_or_else(|| {
                        "The offline Windows speech engine stopped.".to_string()
                    });
                    let _ = control_tx.send(HelperControl::Error(text.clone()));
                    let _ = event_app.emit("native-speech-error", text);
                }
                _ => {}
            }
        }
        let _ = control_tx.send(HelperControl::Closed);
    });

    let mut process = DictationProcess {
        child,
        controls: control_rx,
    };
    wait_for_control(
        &mut process,
        |control| matches!(control, HelperControl::Ready),
        Duration::from_secs(25),
    )?;
    Ok(process)
}

fn ensure_helper(app: &AppHandle) -> Result<(), String> {
    let mut slot = dictation_process()
        .lock()
        .map_err(|_| "The offline Windows speech engine could not be opened.".to_string())?;
    if let Some(process) = slot.as_mut() {
        if process.child.try_wait().ok().flatten().is_none() {
            return Ok(());
        }
    }
    *slot = Some(spawn_helper(app)?);
    Ok(())
}

#[tauri::command]
pub fn prepare_native_dictation(app: AppHandle) -> Result<(), String> {
    ensure_helper(&app)
}

#[tauri::command]
pub fn start_native_dictation(app: AppHandle) -> Result<(), String> {
    ensure_helper(&app)?;
    let mut slot = dictation_process()
        .lock()
        .map_err(|_| "The offline Windows speech engine could not be opened.".to_string())?;
    let process = slot
        .as_mut()
        .ok_or_else(|| "The offline Windows speech engine is unavailable.".to_string())?;
    write_command(process, "start")?;
    wait_for_control(
        process,
        |control| matches!(control, HelperControl::Listening),
        Duration::from_secs(5),
    )
}

#[tauri::command]
pub fn stop_native_dictation() {
    let Ok(mut slot) = dictation_process().lock() else {
        return;
    };
    let Some(process) = slot.as_mut() else {
        return;
    };
    if write_command(process, "stop").is_ok() {
        let _ = wait_for_control(
            process,
            |control| matches!(control, HelperControl::Stopped),
            Duration::from_secs(3),
        );
    }
}

pub fn shutdown_native_dictation() {
    let process = dictation_process()
        .lock()
        .ok()
        .and_then(|mut slot| slot.take());
    if let Some(mut process) = process {
        let _ = write_command(&mut process, "exit");
        for _ in 0..12 {
            if process.child.try_wait().ok().flatten().is_some() {
                return;
            }
            std::thread::sleep(Duration::from_millis(25));
        }
        let _ = process.child.kill();
        let _ = process.child.wait();
    }
}

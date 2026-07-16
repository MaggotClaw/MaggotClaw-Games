use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

const VOICE_MODEL: &str = "en_GB-cori-high.onnx";

fn piper_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let mut candidates = Vec::new();
    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join("resources").join("piper"));
        candidates.push(resource_dir.join("piper"));
    }
    candidates.push(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join("piper"),
    );

    candidates
        .into_iter()
        .find(|path| path.join("piper.exe").is_file() && path.join(VOICE_MODEL).is_file())
        .ok_or_else(|| "The local natural voice is missing from this installation.".to_string())
}

fn temporary_wav_path() -> PathBuf {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    std::env::temp_dir().join(format!(
        "maggotclaw-piper-{}-{stamp}.wav",
        std::process::id()
    ))
}

fn run_piper(piper: &Path, text: &str, rate: f64) -> Result<Vec<u8>, String> {
    let output_path = temporary_wav_path();
    let model_path = piper.join(VOICE_MODEL);
    let length_scale = (1.0 / rate.clamp(0.65, 1.6)).to_string();

    let mut command = Command::new(piper.join("piper.exe"));
    command
        .current_dir(piper)
        .arg("--model")
        .arg(model_path)
        .arg("--output_file")
        .arg(&output_path)
        .arg("--length_scale")
        .arg(length_scale)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);

    let mut child = command
        .spawn()
        .map_err(|error| format!("The local natural voice could not start: {error}"))?;
    child
        .stdin
        .as_mut()
        .ok_or_else(|| "The local natural voice could not receive the text.".to_string())?
        .write_all(format!("{}\n", text.trim()).as_bytes())
        .map_err(|_| "The local natural voice could not receive the text.".to_string())?;
    drop(child.stdin.take());

    let result = child
        .wait_with_output()
        .map_err(|_| "The local natural voice stopped unexpectedly.".to_string())?;
    if !result.status.success() {
        let detail = String::from_utf8_lossy(&result.stderr);
        let _ = fs::remove_file(&output_path);
        return Err(format!(
            "The local natural voice could not create speech. {}",
            detail.trim()
        ));
    }

    let audio = fs::read(&output_path)
        .map_err(|_| "The local natural voice did not create readable audio.".to_string());
    let _ = fs::remove_file(output_path);
    audio
}

#[tauri::command]
pub async fn synthesize_piper_speech(
    app: AppHandle,
    text: String,
    rate: f64,
) -> Result<tauri::ipc::Response, String> {
    if text.trim().is_empty() {
        return Err("There is no text to read aloud.".to_string());
    }
    let piper = piper_dir(&app)?;
    let audio = tauri::async_runtime::spawn_blocking(move || run_piper(&piper, &text, rate))
        .await
        .map_err(|_| "The local natural voice task stopped unexpectedly.".to_string())??;
    Ok(tauri::ipc::Response::new(audio))
}

#[cfg(all(test, windows))]
mod tests {
    use super::{run_piper, VOICE_MODEL};
    use std::path::PathBuf;

    #[test]
    fn bundled_voice_creates_wave_audio() {
        let piper = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join("piper");
        assert!(piper.join(VOICE_MODEL).is_file());
        let audio = run_piper(&piper, "The local voice is ready.", 1.0).unwrap();
        assert!(audio.starts_with(b"RIFF"));
        assert_eq!(&audio[8..12], b"WAVE");
    }
}

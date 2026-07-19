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

/// The voice that ships in the installer, and the fallback whenever a chosen
/// one has gone missing.
const VOICE_MODEL: &str = "en_GB-cori-high.onnx";

/// Voices downloaded later live beside the app's own data rather than in the
/// installation folder, which an update replaces wholesale.
pub fn voices_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|_| "Windows could not locate the app's data folder.".to_string())?
        .join("voices");
    std::fs::create_dir_all(&dir)
        .map_err(|_| "The voices folder could not be created.".to_string())?;
    Ok(dir)
}

/// Where the chosen voice actually is. A downloaded voice wins; the bundled one
/// catches everything else, so a deleted file means a plainer voice rather than
/// silence.
fn model_for(app: &AppHandle, piper: &Path, chosen: Option<&str>) -> PathBuf {
    if let Some(name) = chosen.map(str::trim).filter(|n| !n.is_empty() && *n != VOICE_MODEL) {
        if let Ok(dir) = voices_dir(app) {
            let downloaded = dir.join(name);
            if downloaded.is_file() {
                return downloaded;
            }
        }
    }
    piper.join(VOICE_MODEL)
}

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

fn run_piper(piper: &Path, model_path: &Path, text: &str, rate: f64) -> Result<Vec<u8>, String> {
    let output_path = temporary_wav_path();
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
    voice: Option<String>,
) -> Result<tauri::ipc::Response, String> {
    if text.trim().is_empty() {
        return Err("There is no text to read aloud.".to_string());
    }
    let piper = piper_dir(&app)?;
    let model = model_for(&app, &piper, voice.as_deref());
    let audio = tauri::async_runtime::spawn_blocking(move || run_piper(&piper, &model, &text, rate))
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
        let audio = run_piper(&piper, &piper.join(VOICE_MODEL), "The local voice is ready.", 1.0).unwrap();
        assert!(audio.starts_with(b"RIFF"));
        assert_eq!(&audio[8..12], b"WAVE");
    }
}

/// Fetches a voice and its settings file, and reports the size written. Both
/// files are required — Piper cannot speak with the model alone — so a partial
/// download is cleaned up rather than left to fail later.
#[tauri::command]
pub async fn download_piper_voice(
    app: AppHandle,
    file_name: String,
    model_url: String,
    config_url: String,
) -> Result<u64, String> {
    if !file_name.ends_with(".onnx") || file_name.contains(['/', '\\', ':']) {
        return Err("That is not a voice file name.".to_string());
    }
    for url in [&model_url, &config_url] {
        if !url.starts_with("https://") {
            return Err("A voice can only be fetched over a secure link.".to_string());
        }
    }
    let dir = voices_dir(&app)?;
    let model_path = dir.join(&file_name);
    let config_path = dir.join(format!("{file_name}.json"));

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(600))
        .build()
        .map_err(|_| "The download could not be prepared.".to_string())?;

    let mut written = 0u64;
    for (url, path) in [(&model_url, &model_path), (&config_url, &config_path)] {
        let response = client
            .get(url)
            .send()
            .await
            .map_err(|_| "The voice could not be downloaded. Check your connection.".to_string())?;
        if !response.status().is_success() {
            let _ = std::fs::remove_file(&model_path);
            let _ = std::fs::remove_file(&config_path);
            return Err(format!("The voice could not be downloaded ({}).", response.status().as_u16()));
        }
        let bytes = response
            .bytes()
            .await
            .map_err(|_| "The voice download was interrupted.".to_string())?;
        // Written under a temporary name first, so an interrupted download can
        // never leave a half-written voice that looks complete.
        let temporary = path.with_extension("part");
        std::fs::write(&temporary, &bytes)
            .map_err(|_| "The voice could not be saved.".to_string())?;
        std::fs::rename(&temporary, path)
            .map_err(|_| "The voice could not be finished.".to_string())?;
        written += bytes.len() as u64;
    }
    Ok(written)
}

/// Which voices are already on this computer, so the app offers what is there
/// rather than asking for the same download twice.
#[tauri::command]
pub fn installed_piper_voices(app: AppHandle) -> Vec<String> {
    let mut found = vec![VOICE_MODEL.to_string()];
    if let Ok(dir) = voices_dir(&app) {
        if let Ok(entries) = std::fs::read_dir(dir) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                // A model is only usable with its settings file beside it.
                if name.ends_with(".onnx") && entry.path().with_extension("onnx.json").is_file() {
                    found.push(name);
                }
            }
        }
    }
    found.sort();
    found.dedup();
    found
}

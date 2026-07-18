use serde_json::Value;
use std::time::Duration;

mod desktop_companion;
mod dropbox;
mod native_speech;
mod piper_speech;
mod project_workspace;

const OPENAI_KEY_SERVICE: &str = "The Long Rot Reader";
const OPENAI_KEY_ACCOUNT: &str = "openai-api-key";

fn api_key_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(OPENAI_KEY_SERVICE, OPENAI_KEY_ACCOUNT)
        .map_err(|_| "Windows could not open secure credential storage.".to_string())
}

fn openai_api_key() -> Result<String, String> {
    api_key_entry()?
        .get_password()
        .map_err(|_| "The OpenAI API key is not configured on this computer.".to_string())
}

#[tauri::command]
fn has_openai_api_key() -> bool {
    openai_api_key().is_ok()
}

#[tauri::command]
fn save_openai_api_key(api_key: String) -> Result<(), String> {
    let trimmed = api_key.trim();
    if !trimmed.starts_with("sk-") || trimmed.len() < 20 {
        return Err("That does not look like a valid OpenAI API key.".to_string());
    }
    api_key_entry()?
        .set_password(trimmed)
        .map_err(|_| "Windows could not save the API key securely.".to_string())
}

fn validate_endpoint(endpoint: &str) -> Result<url::Url, String> {
    let parsed = url::Url::parse(endpoint)
        .map_err(|_| "The project connection address is invalid.".to_string())?;
    let local_http = parsed.scheme() == "http"
        && matches!(
            parsed.host_str(),
            Some("127.0.0.1") | Some("localhost") | Some("::1")
        );
    if parsed.scheme() != "https" && !local_http {
        return Err(
            "The project connection must use HTTPS, except for this device's local MCP."
                .to_string(),
        );
    }
    if parsed.path() != "/mcp" {
        return Err("The project connection address must end with /mcp.".to_string());
    }
    Ok(parsed)
}

#[tauri::command]
async fn mcp_call(endpoint: String, bearer_token: String, body: Value) -> Result<Value, String> {
    let endpoint = validate_endpoint(&endpoint)?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|_| {
            "The project connection could not be prepared. Nothing was changed.".to_string()
        })?;
    // The MCP Streamable HTTP transport rejects requests (406) unless the client
    // declares it accepts both JSON and SSE, even though this server replies JSON.
    let mut request = client
        .post(endpoint)
        .header("accept", "application/json, text/event-stream")
        .json(&body);
    if !bearer_token.is_empty() {
        request = request.bearer_auth(bearer_token);
    }
    let response = request.send().await.map_err(|_| {
        "The application could not reach the project files. Nothing was changed.".to_string()
    })?;
    let status = response.status();
    let value: Value = response.json().await.map_err(|_| {
        "The project returned an unreadable response. Nothing was changed.".to_string()
    })?;
    if !status.is_success() {
        return Err(format!(
            "The project connection failed ({}). Nothing was changed.",
            status.as_u16()
        ));
    }
    Ok(value)
}

// Ask GitHub for a repository's latest published release. Runs Rust-side so the
// call is not blocked by the app's connect-src content-security policy.
#[tauri::command]
async fn fetch_latest_release(repo: String) -> Result<Value, String> {
    // Accept only a clean "owner/name" slug — never an arbitrary URL.
    let valid_slug = repo.matches('/').count() == 1
        && !repo.starts_with('/')
        && !repo.ends_with('/')
        && repo
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | '/'));
    if !valid_slug {
        return Err("The update source is not a valid GitHub owner/name.".to_string());
    }
    let url = format!("https://api.github.com/repos/{}/releases/latest", repo);
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|_| "The update check could not be prepared.".to_string())?;
    let response = client
        .get(url)
        .header("accept", "application/vnd.github+json")
        .header("user-agent", "MaggotClaw-Games-Updater")
        .send()
        .await
        .map_err(|_| {
            "Could not reach the update service. Check your internet connection.".to_string()
        })?;
    let status = response.status();
    if status.as_u16() == 404 {
        return Err("No published releases were found for the update source yet.".to_string());
    }
    if !status.is_success() {
        return Err(format!(
            "The update service replied with an error ({}).",
            status.as_u16()
        ));
    }
    response
        .json()
        .await
        .map_err(|_| "The update service returned an unreadable response.".to_string())
}

// Open a web link in the user's default browser. Refuses anything that is not a
// plain http(s) URL, and rejects shell metacharacters so nothing can be injected.
#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    // mailto: and sms: open the user's own email or messaging program with the
    // share link prefilled — the app never sends anything itself.
    if (url.starts_with("mailto:") || url.starts_with("sms:")) && !url.contains(['|','^','<','>','"']) {
        // rundll32 takes the address directly — no shell, so & in the link is safe.
        return std::process::Command::new("rundll32")
            .args(["url.dll,FileProtocolHandler", &url])
            .spawn()
            .map(|_| ())
            .map_err(|_| "The email program could not be opened.".to_string());
    }
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("Only web links can be opened.".to_string());
    }
    if url.contains(|c: char| matches!(c, '&' | '|' | '<' | '>' | '^' | '"' | ' ' | '\n' | '\r')) {
        return Err("That link cannot be opened automatically. Use the release page instead.".to_string());
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &url])
            .spawn()
            .map_err(|_| "Windows could not open the link.".to_string())?;
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = url;
        Err("Opening links is only supported on Windows in this build.".to_string())
    }
}

/// Posts a message to a Discord webhook. Only real Discord webhook addresses
/// are accepted, so this cannot be used to send data anywhere else.
#[tauri::command]
async fn post_discord_webhook(url: String, content: String) -> Result<(), String> {
    let parsed = url::Url::parse(&url)
        .map_err(|_| "The Discord webhook address is invalid.".to_string())?;
    let host_ok = matches!(parsed.host_str(), Some("discord.com") | Some("discordapp.com"));
    if parsed.scheme() != "https" || !host_ok || !parsed.path().starts_with("/api/webhooks/") {
        return Err("Only Discord webhook addresses are allowed.".to_string());
    }
    if content.trim().is_empty() || content.len() > 1900 {
        return Err("The message must be between 1 and 1900 characters.".to_string());
    }
    let response = reqwest::Client::new()
        .post(parsed)
        .json(&serde_json::json!({ "content": content }))
        .timeout(Duration::from_secs(15))
        .send()
        .await
        .map_err(|_| "Discord could not be reached. The request code still works by hand.".to_string())?;
    if !response.status().is_success() {
        return Err(format!(
            "Discord did not accept the message ({}).",
            response.status().as_u16()
        ));
    }
    Ok(())
}

fn discord_api_url(path: &str) -> Result<url::Url, String> {
    let full = format!("https://discord.com/api/v10/{path}");
    url::Url::parse(&full).map_err(|_| "The Discord address is invalid.".to_string())
}

/// Reads recent messages from one Discord channel using the owner's bot key.
/// Talks only to discord.com and returns the raw message list.
#[tauri::command]
async fn fetch_discord_messages(
    bot_token: String,
    channel_id: String,
    limit: u8,
    after: Option<String>,
) -> Result<Value, String> {
    if !channel_id.chars().all(|c| c.is_ascii_digit()) || channel_id.is_empty() {
        return Err("The channel ID must be a number.".to_string());
    }
    let capped = limit.clamp(1, 100);
    // "after" pages forward from a known message id, so a machine that was
    // offline can catch up on everything rather than only the newest page.
    let cursor = match after {
        Some(id) if !id.is_empty() && id.chars().all(|c| c.is_ascii_digit()) => {
            format!("&after={id}")
        }
        _ => String::new(),
    };
    let endpoint =
        discord_api_url(&format!("channels/{channel_id}/messages?limit={capped}{cursor}"))?;
    let response = reqwest::Client::new()
        .get(endpoint)
        .header("authorization", format!("Bot {}", bot_token.trim()))
        .timeout(Duration::from_secs(15))
        .send()
        .await
        .map_err(|_| "Discord could not be reached.".to_string())?;
    let status = response.status();
    let value: Value = response
        .json()
        .await
        .map_err(|_| "Discord returned an unreadable response.".to_string())?;
    if !status.is_success() {
        return Err(match status.as_u16() {
            401 => "Discord rejected the bot key. Check it in Settings.".to_string(),
            403 => "The bot is not allowed into that channel. Invite it to the server and give it access.".to_string(),
            code => format!("Discord refused the request ({code})."),
        });
    }
    Ok(value)
}

/// Posts a message to a channel as the bot (used for sending unlock codes back).
#[tauri::command]
async fn post_discord_bot_message(
    bot_token: String,
    channel_id: String,
    content: String,
) -> Result<(), String> {
    if !channel_id.chars().all(|c| c.is_ascii_digit()) || channel_id.is_empty() {
        return Err("The channel ID must be a number.".to_string());
    }
    if content.trim().is_empty() || content.len() > 1900 {
        return Err("The message must be between 1 and 1900 characters.".to_string());
    }
    let endpoint = discord_api_url(&format!("channels/{channel_id}/messages"))?;
    let response = reqwest::Client::new()
        .post(endpoint)
        .header("authorization", format!("Bot {}", bot_token.trim()))
        .json(&serde_json::json!({ "content": content }))
        .timeout(Duration::from_secs(15))
        .send()
        .await
        .map_err(|_| "Discord could not be reached.".to_string())?;
    if !response.status().is_success() {
        return Err(format!(
            "Discord did not accept the message ({}).",
            response.status().as_u16()
        ));
    }
    Ok(())
}

/// Downloads a GitHub release installer and launches it, so updating never
/// leaves the app for a browser. GitHub hosts only.
#[tauri::command]
async fn download_and_install_update(url: String) -> Result<(), String> {
    let parsed = url::Url::parse(&url).map_err(|_| "The download address is invalid.".to_string())?;
    let host = parsed.host_str().unwrap_or("");
    let allowed = host == "github.com" || host.ends_with(".githubusercontent.com");
    if parsed.scheme() != "https" || !allowed {
        return Err("Only GitHub download addresses are allowed.".to_string());
    }
    let response = reqwest::Client::new()
        .get(parsed)
        .timeout(Duration::from_secs(600))
        .send()
        .await
        .map_err(|_| "The download could not be started.".to_string())?;
    if !response.status().is_success() {
        return Err(format!("The download failed ({}).", response.status().as_u16()));
    }
    let bytes = response.bytes().await.map_err(|_| "The download was interrupted.".to_string())?;
    let path = std::env::temp_dir().join("MaggotClaw-Games-update-setup.exe");
    std::fs::write(&path, &bytes).map_err(|_| "The installer could not be saved.".to_string())?;
    std::process::Command::new("cmd")
        .args(["/C", "start", "", path.to_string_lossy().as_ref()])
        .spawn()
        .map(|_| ())
        .map_err(|_| "The installer could not be started.".to_string())
}

#[tauri::command]
async fn openai_transcribe(audio: Vec<u8>, mime_type: String) -> Result<String, String> {
    if audio.is_empty() {
        return Err("No recording was available to transcribe.".to_string());
    }
    let filename = if mime_type.contains("mp4") {
        "speech.mp4"
    } else {
        "speech.webm"
    };
    let part = reqwest::multipart::Part::bytes(audio)
        .file_name(filename)
        .mime_str(&mime_type)
        .map_err(|_| "The recording format was not supported.".to_string())?;
    let form = reqwest::multipart::Form::new()
        .text("model", "gpt-4o-transcribe")
        .text("prompt", "The Long Rot; Silas Crane; Vina; Hiram; Josiah Curn; Aedan; Elowen; Blackwood; Mourning Bend; The Pull")
        .part("file", part);
    let response = reqwest::Client::new()
        .post("https://api.openai.com/v1/audio/transcriptions")
        .bearer_auth(openai_api_key()?)
        .multipart(form)
        .send()
        .await
        .map_err(|_| {
            "The transcription service could not be reached. Your recording remains on this device."
                .to_string()
        })?;
    let status = response.status();
    let value: Value = response
        .json()
        .await
        .map_err(|_| "The transcription service returned an unreadable response.".to_string())?;
    if !status.is_success() {
        return Err(openai_safe_error(status.as_u16(), &value));
    }
    value
        .get("text")
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| "The transcription did not contain any text.".to_string())
}

#[tauri::command]
async fn openai_respond(input: String, conversation: Vec<Value>) -> Result<String, String> {
    if input.trim().is_empty() {
        return Err("Please say or type a question first.".to_string());
    }
    let mut transcript = String::new();
    for turn in conversation.iter().rev().take(10).rev() {
        let role = turn.get("role").and_then(Value::as_str).unwrap_or("user");
        let text = turn.get("text").and_then(Value::as_str).unwrap_or("");
        transcript.push_str(&format!("{}: {}\n", role, text));
    }
    transcript.push_str(&format!("user: {}", input));
    let body = serde_json::json!({
        "model": "gpt-5.4-mini",
        "instructions": "You are the voice project assistant for the book The Long Rot. Be concise, clear, and honest. Distinguish established project facts from suggestions. Never claim that a project file changed. This initial talk mode has no live project-file tool access, so say when an answer requires consulting project files.",
        "input": transcript,
        "max_output_tokens": 800
    });
    let response = reqwest::Client::new()
        .post("https://api.openai.com/v1/responses")
        .bearer_auth(openai_api_key()?)
        .json(&body)
        .send()
        .await
        .map_err(|_| "The AI service could not be reached. Nothing was changed.".to_string())?;
    let status = response.status();
    let value: Value = response.json().await.map_err(|_| {
        "The AI service returned an unreadable response. Nothing was changed.".to_string()
    })?;
    if !status.is_success() {
        return Err(openai_safe_error(status.as_u16(), &value));
    }
    extract_output_text(&value)
        .ok_or_else(|| "The AI response did not contain readable text.".to_string())
}

#[tauri::command]
async fn openai_speech(text: String) -> Result<Vec<u8>, String> {
    let body = serde_json::json!({ "model": "tts-1", "voice": "coral", "input": text, "response_format": "mp3", "speed": 1.0 });
    let response = reqwest::Client::new()
        .post("https://api.openai.com/v1/audio/speech")
        .bearer_auth(openai_api_key()?)
        .json(&body)
        .send()
        .await
        .map_err(|_| {
            "The speaking service could not be reached. The written answer is still available."
                .to_string()
        })?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!(
            "The speaking service could not complete the request ({}).",
            status.as_u16()
        ));
    }
    response
        .bytes()
        .await
        .map(|bytes| bytes.to_vec())
        .map_err(|_| "The spoken response could not be downloaded.".to_string())
}

fn extract_output_text(value: &Value) -> Option<String> {
    if let Some(text) = value.get("output_text").and_then(Value::as_str) {
        return Some(text.to_string());
    }
    value
        .get("output")?
        .as_array()?
        .iter()
        .flat_map(|item| {
            item.get("content")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
        })
        .find_map(|content| {
            content
                .get("text")
                .and_then(Value::as_str)
                .map(str::to_string)
        })
}

fn openai_safe_error(status: u16, value: &Value) -> String {
    let code = value
        .pointer("/error/code")
        .and_then(Value::as_str)
        .unwrap_or("");
    match (status, code) {
        (401, _) => "The OpenAI API key was not accepted. Update it in Settings.".to_string(),
        (429, "insufficient_quota") => {
            "The OpenAI account does not currently have available API credit.".to_string()
        }
        (429, _) => {
            "The AI service is busy or its usage limit was reached. Please try again shortly."
                .to_string()
        }
        _ => format!(
            "The AI service could not complete the request ({}). Nothing was changed.",
            status
        ),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            mcp_call,
            fetch_latest_release,
            open_url,
            post_discord_webhook,
            download_and_install_update,
            fetch_discord_messages,
            post_discord_bot_message,
            has_openai_api_key,
            save_openai_api_key,
            openai_transcribe,
            openai_respond,
            openai_speech,
            desktop_companion::conversation_target_status,
            desktop_companion::insert_conversation_draft,
            desktop_companion::clear_conversation_draft,
            desktop_companion::send_conversation_message,
            desktop_companion::conversation_response_state,
            desktop_companion::conversation_is_foreground,
            desktop_companion::copy_latest_conversation_response,
            native_speech::prepare_native_dictation,
            native_speech::start_native_dictation,
            native_speech::stop_native_dictation,
            piper_speech::synthesize_piper_speech,
            project_workspace::initialize_project_workspace,
            project_workspace::project_workspace_status,
            project_workspace::save_project_text_file,
            project_workspace::record_project_binary_file,
            project_workspace::open_project_workspace,
            project_workspace::list_project_documents,
            project_workspace::read_project_document,
            project_workspace::read_project_document_bytes,
            project_workspace::list_workspace_docx,
            project_workspace::list_approved_uploads,
            project_workspace::read_approved_upload,
            project_workspace::archive_approved_upload,
            project_workspace::retire_project_file,
            project_workspace::save_idea_note,
            project_workspace::write_workspace_file,
            project_workspace::move_workspace_file,
            project_workspace::search_project_documents,
            dropbox::dropbox_list_folder,
            dropbox::dropbox_read_text,
            dropbox::dropbox_current_revision,
            dropbox::dropbox_write_text,
            dropbox::dropbox_shared_link,
            dropbox::fetch_dropbox_link_text,
            dropbox::read_bridge_env
        ])
        .build(tauri::generate_context!())
        .expect("error while building The Long Rot Voice")
        .run(|_, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                native_speech::shutdown_native_dictation();
            }
        });
}

#[cfg(test)]
mod tests {
    use super::{extract_output_text, validate_endpoint};

    #[test]
    fn allows_https_and_local_mcp_only() {
        assert!(validate_endpoint("https://example.com/mcp").is_ok());
        assert!(validate_endpoint("http://127.0.0.1:3000/mcp").is_ok());
        assert!(validate_endpoint("http://example.com/mcp").is_err());
        assert!(validate_endpoint("https://example.com/not-mcp").is_err());
    }

    #[test]
    fn extracts_responses_output_text() {
        let response =
            serde_json::json!({"output":[{"content":[{"type":"output_text","text":"Answer"}]}]});
        assert_eq!(extract_output_text(&response).as_deref(), Some("Answer"));
    }
}

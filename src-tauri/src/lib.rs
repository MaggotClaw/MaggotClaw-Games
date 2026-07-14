use serde_json::Value;

mod desktop_companion;

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
    let client = reqwest::Client::new();
    let mut request = client.post(endpoint).json(&body);
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
            has_openai_api_key,
            save_openai_api_key,
            openai_transcribe,
            openai_respond,
            openai_speech,
            desktop_companion::codex_target_status,
            desktop_companion::insert_codex_draft,
            desktop_companion::copy_latest_codex_response
        ])
        .run(tauri::generate_context!())
        .expect("error while running The Long Rot Voice");
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

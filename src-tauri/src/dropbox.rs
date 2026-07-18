// Direct Dropbox access. The app performs the same four operations the local
// MCP bridge did — list a folder, read a text file, check the newest revision,
// write a text file — straight against Dropbox, using the project's app key,
// secret, and self-renewing refresh token. With these on a machine, the bridge
// no longer needs to be running for downloads or uploads.

use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::time::{Duration, Instant};

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DropboxCreds {
    app_key: String,
    app_secret: String,
    refresh_token: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DropboxEntry {
    pub name: String,
    pub path: String,
    #[serde(rename = "type")]
    pub kind: String,
}

// One cached short-lived access token, renewed from the refresh token a few
// minutes before it expires.
static TOKEN_CACHE: Mutex<Option<(String, Instant)>> = Mutex::new(None);

fn friendly(status: u16) -> String {
    match status {
        401 => "The Dropbox connection has expired or the key is wrong. Nothing was changed. Check the project file keys in Settings.".to_string(),
        409 => "Dropbox does not know that file or folder. Nothing was changed.".to_string(),
        429 => "Dropbox asked the app to slow down. Nothing was changed — try again in a moment.".to_string(),
        code => format!("Dropbox could not complete that request ({code}). Nothing was changed."),
    }
}

async fn access_token(creds: &DropboxCreds) -> Result<String, String> {
    if let Some((token, until)) = TOKEN_CACHE.lock().unwrap().clone() {
        if Instant::now() < until {
            return Ok(token);
        }
    }
    let response = reqwest::Client::new()
        .post("https://api.dropbox.com/oauth2/token")
        .form(&[
            ("grant_type", "refresh_token"),
            ("refresh_token", creds.refresh_token.trim()),
            ("client_id", creds.app_key.trim()),
            ("client_secret", creds.app_secret.trim()),
        ])
        .timeout(Duration::from_secs(20))
        .send()
        .await
        .map_err(|_| "Dropbox could not be reached.".to_string())?;
    if !response.status().is_success() {
        return Err(friendly(response.status().as_u16()));
    }
    let value: serde_json::Value = response
        .json()
        .await
        .map_err(|_| "Dropbox returned an unreadable sign-in response.".to_string())?;
    let token = value["access_token"]
        .as_str()
        .ok_or_else(|| "Dropbox did not return an access token.".to_string())?
        .to_string();
    let lifetime = value["expires_in"].as_u64().unwrap_or(14400).saturating_sub(300);
    *TOKEN_CACHE.lock().unwrap() = Some((token.clone(), Instant::now() + Duration::from_secs(lifetime)));
    Ok(token)
}

async fn api_call(
    creds: &DropboxCreds,
    endpoint: &str,
    body: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let token = access_token(creds).await?;
    let response = reqwest::Client::new()
        .post(format!("https://api.dropboxapi.com/2/{endpoint}"))
        .bearer_auth(token)
        .json(&body)
        .timeout(Duration::from_secs(30))
        .send()
        .await
        .map_err(|_| "Dropbox could not be reached.".to_string())?;
    let status = response.status();
    if !status.is_success() {
        return Err(friendly(status.as_u16()));
    }
    response
        .json()
        .await
        .map_err(|_| "Dropbox returned an unreadable response.".to_string())
}

#[tauri::command]
pub async fn dropbox_list_folder(
    creds: DropboxCreds,
    path: String,
) -> Result<Vec<DropboxEntry>, String> {
    let mut entries = Vec::new();
    let mut value = api_call(&creds, "files/list_folder", serde_json::json!({ "path": path })).await?;
    loop {
        for item in value["entries"].as_array().cloned().unwrap_or_default() {
            let kind = match item[".tag"].as_str() {
                Some("folder") => "folder",
                Some("file") => "file",
                _ => continue,
            };
            entries.push(DropboxEntry {
                name: item["name"].as_str().unwrap_or_default().to_string(),
                path: item["path_display"].as_str().unwrap_or_default().to_string(),
                kind: kind.to_string(),
            });
        }
        if !value["has_more"].as_bool().unwrap_or(false) {
            break;
        }
        let cursor = value["cursor"].as_str().unwrap_or_default().to_string();
        value = api_call(&creds, "files/list_folder/continue", serde_json::json!({ "cursor": cursor })).await?;
    }
    Ok(entries)
}

#[tauri::command]
pub async fn dropbox_read_text(creds: DropboxCreds, path: String) -> Result<String, String> {
    let token = access_token(&creds).await?;
    let arg = serde_json::json!({ "path": path }).to_string();
    let response = reqwest::Client::new()
        .post("https://content.dropboxapi.com/2/files/download")
        .bearer_auth(token)
        .header("Dropbox-API-Arg", arg)
        .timeout(Duration::from_secs(60))
        .send()
        .await
        .map_err(|_| "Dropbox could not be reached.".to_string())?;
    let status = response.status();
    if !status.is_success() {
        return Err(friendly(status.as_u16()));
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|_| "The file could not be read from Dropbox.".to_string())?;
    Ok(String::from_utf8_lossy(&bytes).to_string())
}

#[tauri::command]
pub async fn dropbox_current_revision(
    creds: DropboxCreds,
    path: String,
) -> Result<Option<String>, String> {
    let value = api_call(
        &creds,
        "files/list_revisions",
        serde_json::json!({ "path": path, "limit": 1 }),
    )
    .await?;
    Ok(value["entries"][0]["rev"].as_str().map(|rev| rev.to_string()))
}

#[tauri::command]
pub async fn dropbox_write_text(
    creds: DropboxCreds,
    path: String,
    content: String,
) -> Result<(), String> {
    let token = access_token(&creds).await?;
    let arg = serde_json::json!({ "path": path, "mode": "overwrite", "autorename": false, "mute": true })
        .to_string();
    let response = reqwest::Client::new()
        .post("https://content.dropboxapi.com/2/files/upload")
        .bearer_auth(token)
        .header("Dropbox-API-Arg", arg)
        .header("content-type", "application/octet-stream")
        .body(content.into_bytes())
        .timeout(Duration::from_secs(60))
        .send()
        .await
        .map_err(|_| "Dropbox could not be reached.".to_string())?;
    let status = response.status();
    if !status.is_success() {
        return Err(friendly(status.as_u16()));
    }
    Ok(())
}

/// A read-only shared link for one file. The link always serves the file's
/// CURRENT contents, so readers automatically get every revision — and they
/// hold no credentials at all: a link can read one file and nothing else.
#[tauri::command]
pub async fn dropbox_shared_link(creds: DropboxCreds, path: String) -> Result<String, String> {
    let token = access_token(&creds).await?;
    let response = reqwest::Client::new()
        .post("https://api.dropboxapi.com/2/sharing/create_shared_link_with_settings")
        .bearer_auth(&token)
        .json(&serde_json::json!({ "path": path }))
        .timeout(Duration::from_secs(30))
        .send()
        .await
        .map_err(|_| "Dropbox could not be reached.".to_string())?;
    let status = response.status();
    let value: serde_json::Value = response
        .json()
        .await
        .map_err(|_| "Dropbox returned an unreadable response.".to_string())?;
    if status.is_success() {
        if let Some(url) = value["url"].as_str() {
            return Ok(url.to_string());
        }
    }
    // The link already exists — Dropbox reports that as an error carrying the
    // existing link, and list_shared_links is the reliable way to fetch it.
    let listed = api_call(
        &creds,
        "sharing/list_shared_links",
        serde_json::json!({ "path": path, "direct_only": true }),
    )
    .await?;
    listed["links"][0]["url"]
        .as_str()
        .map(|url| url.to_string())
        .ok_or_else(|| "Dropbox could not provide a shared link for that file.".to_string())
}

/// Fetches text from a Dropbox shared link. Restricted to Dropbox's own
/// domains so this can never be pointed anywhere else.
#[tauri::command]
pub async fn fetch_dropbox_link_text(url: String) -> Result<String, String> {
    let parsed = url::Url::parse(&url).map_err(|_| "That link is not a valid address.".to_string())?;
    let host_ok = parsed
        .host_str()
        .map(|host| host == "dropbox.com" || host.ends_with(".dropbox.com") || host.ends_with(".dropboxusercontent.com"))
        .unwrap_or(false);
    if parsed.scheme() != "https" || !host_ok {
        return Err("Only Dropbox links can be opened here.".to_string());
    }
    // dl=1 asks for the raw file rather than Dropbox's preview page.
    let mut direct = parsed.clone();
    let pairs: Vec<(String, String)> = parsed
        .query_pairs()
        .filter(|(key, _)| key != "dl")
        .map(|(key, value)| (key.to_string(), value.to_string()))
        .collect();
    direct.query_pairs_mut().clear().extend_pairs(pairs).append_pair("dl", "1");
    let response = reqwest::Client::new()
        .get(direct)
        .timeout(Duration::from_secs(60))
        .send()
        .await
        .map_err(|_| "The file link could not be reached.".to_string())?;
    if !response.status().is_success() {
        return Err(format!(
            "The file link did not answer ({}). The owner may need to publish reader links again.",
            response.status().as_u16()
        ));
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|_| "The file could not be read from its link.".to_string())?;
    Ok(String::from_utf8_lossy(&bytes).to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeEnvCreds {
    pub app_key: String,
    pub app_secret: String,
    pub refresh_token: String,
}

/// One-press convenience for the owner: read the Dropbox keys the bridge
/// already holds, so nothing needs re-typing. Local file read only.
#[tauri::command]
pub fn read_bridge_env() -> Result<BridgeEnvCreds, String> {
    let profile = std::env::var_os("USERPROFILE")
        .map(std::path::PathBuf::from)
        .ok_or_else(|| "Windows could not locate your user folder.".to_string())?;
    let env_path = profile.join("the-long-rot-mcp").join(".env");
    let text = std::fs::read_to_string(&env_path)
        .map_err(|_| "The bridge's settings file could not be found. Enter the keys by hand instead.".to_string())?;
    let mut app_key = String::new();
    let mut app_secret = String::new();
    let mut refresh_token = String::new();
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('#') {
            continue;
        }
        let Some((key, value)) = trimmed.split_once('=') else { continue };
        let value = value.trim().trim_matches('"').trim_matches('\'').to_string();
        match key.trim() {
            "DROPBOX_APP_KEY" => app_key = value,
            "DROPBOX_APP_SECRET" => app_secret = value,
            "DROPBOX_REFRESH_TOKEN" => refresh_token = value,
            _ => {}
        }
    }
    if app_key.is_empty() || app_secret.is_empty() || refresh_token.is_empty() {
        return Err("The bridge's settings file is missing one of the Dropbox keys.".to_string());
    }
    Ok(BridgeEnvCreds { app_key, app_secret, refresh_token })
}

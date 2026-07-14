use serde_json::Value;

fn validate_endpoint(endpoint: &str) -> Result<url::Url, String> {
    let parsed = url::Url::parse(endpoint).map_err(|_| "The project connection address is invalid.".to_string())?;
    let local_http = parsed.scheme() == "http"
        && matches!(parsed.host_str(), Some("127.0.0.1") | Some("localhost") | Some("::1"));
    if parsed.scheme() != "https" && !local_http {
        return Err("The project connection must use HTTPS, except for this device's local MCP.".to_string());
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
    let response = request.send().await.map_err(|_| "The application could not reach the project files. Nothing was changed.".to_string())?;
    let status = response.status();
    let value: Value = response.json().await.map_err(|_| "The project returned an unreadable response. Nothing was changed.".to_string())?;
    if !status.is_success() {
        return Err(format!("The project connection failed ({}). Nothing was changed.", status.as_u16()));
    }
    Ok(value)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![mcp_call])
        .run(tauri::generate_context!())
        .expect("error while running The Long Rot Voice");
}

#[cfg(test)]
mod tests {
    use super::validate_endpoint;

    #[test]
    fn allows_https_and_local_mcp_only() {
        assert!(validate_endpoint("https://example.com/mcp").is_ok());
        assert!(validate_endpoint("http://127.0.0.1:3000/mcp").is_ok());
        assert!(validate_endpoint("http://example.com/mcp").is_err());
        assert!(validate_endpoint("https://example.com/not-mcp").is_err());
    }
}


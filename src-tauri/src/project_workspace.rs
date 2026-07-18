use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    env, fs,
    path::{Component, Path, PathBuf},
    process::Command,
};

const PROJECT_NAME: &str = "The Long Rot";
const DROPBOX_ROOT: &str = "/The Long Rot";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceFile {
    dropbox_path: String,
    local_relative_path: String,
    revision_id: Option<String>,
    content_hash: String,
    downloaded_at: String,
    byte_count: usize,
    status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceManifest {
    project_name: String,
    dropbox_root: String,
    workspace_path: String,
    created_at: String,
    last_download_at: Option<String>,
    upload_enabled: bool,
    files: Vec<WorkspaceFile>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceStatus {
    workspace_path: String,
    initialized: bool,
    downloaded_files: usize,
    pending_binary_files: usize,
    last_download_at: Option<String>,
    upload_enabled: bool,
}

fn timestamp() -> String {
    // UTC is enough for durable ordering and avoids adding a time dependency.
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_secs().to_string())
        .unwrap_or_else(|_| "0".to_string())
}

fn workspace_root() -> Result<PathBuf, String> {
    let profile = env::var_os("USERPROFILE")
        .map(PathBuf::from)
        .ok_or_else(|| "Windows could not locate your user folder.".to_string())?;
    Ok(profile
        .join("Documents")
        .join("MaggotClaw Games Projects")
        .join(PROJECT_NAME))
}

fn manifest_path(root: &Path) -> PathBuf {
    root.join(".mcg-project").join("manifest.json")
}

fn empty_manifest(root: &Path) -> WorkspaceManifest {
    WorkspaceManifest {
        project_name: PROJECT_NAME.to_string(),
        dropbox_root: DROPBOX_ROOT.to_string(),
        workspace_path: root.display().to_string(),
        created_at: timestamp(),
        last_download_at: None,
        upload_enabled: false,
        files: Vec::new(),
    }
}

fn load_manifest(root: &Path) -> Result<WorkspaceManifest, String> {
    let path = manifest_path(root);
    if !path.exists() {
        return Ok(empty_manifest(root));
    }
    let text = fs::read_to_string(path)
        .map_err(|_| "The local project inventory could not be read.".to_string())?;
    serde_json::from_str(&text)
        .map_err(|_| "The local project inventory is damaged and was not changed.".to_string())
}

fn save_manifest(root: &Path, manifest: &WorkspaceManifest) -> Result<(), String> {
    let path = manifest_path(root);
    let temporary = path.with_extension("json.tmp");
    let contents = serde_json::to_vec_pretty(manifest)
        .map_err(|_| "The local project inventory could not be prepared.".to_string())?;
    fs::write(&temporary, contents)
        .map_err(|_| "The local project inventory could not be saved.".to_string())?;
    // fs::rename on Windows replaces an existing destination atomically, so the
    // old inventory exists right up until the new one takes its place.
    fs::rename(&temporary, &path)
        .map_err(|_| "The local project inventory could not be finalized.".to_string())
}

fn initialize() -> Result<PathBuf, String> {
    let root = workspace_root()?;
    for folder in [
        "01 Originals",
        "02 Working Files",
        "03 AI Context",
        "04 Proposed Changes",
        "05 Approved Uploads",
        "06 Exports",
        "07 Backups",
        ".mcg-project",
    ] {
        fs::create_dir_all(root.join(folder))
            .map_err(|_| format!("Windows could not create the local {folder} folder."))?;
    }
    let path = manifest_path(&root);
    if !path.exists() {
        save_manifest(&root, &empty_manifest(&root))?;
    }
    Ok(root)
}

fn safe_relative_path(dropbox_path: &str) -> Result<PathBuf, String> {
    let normalized = dropbox_path.replace('\\', "/");
    let relative = normalized
        .strip_prefix("/The Long Rot/")
        .ok_or_else(|| "That file is outside The Long Rot project.".to_string())?;
    let path = Path::new(relative);
    if path.as_os_str().is_empty()
        || path
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
    {
        return Err("That project file path is unsafe.".to_string());
    }
    Ok(path.to_path_buf())
}

fn write_copy(path: &Path, content: &[u8]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|_| "A local project folder could not be created.".to_string())?;
    }
    let temporary = path.with_extension(format!(
        "{}.tmp",
        path.extension()
            .and_then(|value| value.to_str())
            .unwrap_or("file")
    ));
    fs::write(&temporary, content)
        .map_err(|_| "A local project file could not be saved.".to_string())?;
    fs::rename(temporary, path)
        .map_err(|_| "A local project file could not be finalized.".to_string())
}

#[tauri::command]
pub fn initialize_project_workspace() -> Result<WorkspaceStatus, String> {
    let root = initialize()?;
    project_workspace_status_from(&root)
}

#[tauri::command]
pub fn project_workspace_status() -> Result<WorkspaceStatus, String> {
    let root = workspace_root()?;
    if !manifest_path(&root).exists() {
        return Ok(WorkspaceStatus {
            workspace_path: root.display().to_string(),
            initialized: false,
            downloaded_files: 0,
            pending_binary_files: 0,
            last_download_at: None,
            upload_enabled: false,
        });
    }
    project_workspace_status_from(&root)
}

fn project_workspace_status_from(root: &Path) -> Result<WorkspaceStatus, String> {
    let manifest = load_manifest(root)?;
    Ok(WorkspaceStatus {
        workspace_path: root.display().to_string(),
        initialized: true,
        downloaded_files: manifest
            .files
            .iter()
            .filter(|item| item.status == "downloaded")
            .count(),
        pending_binary_files: manifest
            .files
            .iter()
            .filter(|item| item.status == "needs-binary-download")
            .count(),
        last_download_at: manifest.last_download_at,
        upload_enabled: false,
    })
}

#[tauri::command]
pub fn save_project_text_file(
    dropbox_path: String,
    content: String,
    revision_id: Option<String>,
) -> Result<WorkspaceFile, String> {
    let root = initialize()?;
    let relative = safe_relative_path(&dropbox_path)?;
    let original = root.join("01 Originals").join(&relative);
    // Appending ".md" (instead of swapping the extension) keeps "Notes.txt"
    // and "Notes.json" from colliding into one AI Context file.
    let ai_relative = PathBuf::from(format!("{}.md", relative.display()));
    let ai_copy = root.join("03 AI Context").join(&ai_relative);
    let mut hasher = Sha256::new();
    hasher.update(content.as_bytes());
    let content_hash = format!("{:x}", hasher.finalize());
    let mut manifest = load_manifest(&root)?;

    if original.exists() {
        let old = fs::read(&original)
            .map_err(|_| "The existing local original could not be backed up.".to_string())?;
        let mut old_hasher = Sha256::new();
        old_hasher.update(&old);
        let old_hash = format!("{:x}", old_hasher.finalize());
        if old_hash != content_hash {
            let backup = root
                .join("07 Backups")
                .join(timestamp())
                .join("01 Originals")
                .join(&relative);
            write_copy(&backup, &old)?;
        }
    }

    write_copy(&original, content.as_bytes())?;
    let heading = relative
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("Project file");
    let ai_content = format!(
        "# {heading}\n\n<!-- Source: {dropbox_path} | Revision: {} | Hash: {content_hash} -->\n\n{content}",
        revision_id.as_deref().unwrap_or("not supplied")
    );
    write_copy(&ai_copy, ai_content.as_bytes())?;

    let record = WorkspaceFile {
        dropbox_path: dropbox_path.clone(),
        local_relative_path: relative.display().to_string(),
        revision_id,
        content_hash,
        downloaded_at: timestamp(),
        byte_count: content.len(),
        status: "downloaded".to_string(),
    };
    manifest
        .files
        .retain(|item| item.dropbox_path != dropbox_path);
    manifest.files.push(record.clone());
    manifest
        .files
        .sort_by(|left, right| left.dropbox_path.cmp(&right.dropbox_path));
    manifest.last_download_at = Some(timestamp());
    manifest.upload_enabled = false;
    save_manifest(&root, &manifest)?;
    Ok(record)
}

#[tauri::command]
pub fn record_project_binary_file(dropbox_path: String) -> Result<WorkspaceFile, String> {
    let root = initialize()?;
    let relative = safe_relative_path(&dropbox_path)?;
    let mut manifest = load_manifest(&root)?;
    let record = WorkspaceFile {
        dropbox_path: dropbox_path.clone(),
        local_relative_path: relative.display().to_string(),
        revision_id: None,
        content_hash: String::new(),
        downloaded_at: timestamp(),
        byte_count: 0,
        status: "needs-binary-download".to_string(),
    };
    manifest
        .files
        .retain(|item| item.dropbox_path != dropbox_path);
    manifest.files.push(record.clone());
    manifest
        .files
        .sort_by(|left, right| left.dropbox_path.cmp(&right.dropbox_path));
    manifest.upload_enabled = false;
    save_manifest(&root, &manifest)?;
    Ok(record)
}

/// A file that vanished from Dropbox (deleted or renamed): its local original
/// and AI copies move into Backups/Removed — never destroyed — and it leaves
/// the inventory so the shelf, search, and AI context stop serving stale text.
#[tauri::command]
pub fn retire_project_file(dropbox_path: String) -> Result<(), String> {
    let root = initialize()?;
    let relative = safe_relative_path(&dropbox_path)?;
    let shelter = root
        .join("07 Backups")
        .join("Removed")
        .join(timestamp());
    let moves = [
        (root.join("01 Originals").join(&relative), shelter.join("01 Originals").join(&relative)),
        // Both AI-copy namings that have existed: "<file>.md" appended and the
        // older extension-swapped form.
        (
            root.join("03 AI Context").join(PathBuf::from(format!("{}.md", relative.display()))),
            shelter.join("03 AI Context").join(PathBuf::from(format!("{}.md", relative.display()))),
        ),
        (
            root.join("03 AI Context").join(relative.with_extension("md")),
            shelter.join("03 AI Context").join(relative.with_extension("md")),
        ),
    ];
    for (from, to) in moves {
        if !from.exists() {
            continue;
        }
        if let Some(parent) = to.parent() {
            fs::create_dir_all(parent)
                .map_err(|_| "The Backups shelter folder could not be created.".to_string())?;
        }
        fs::rename(&from, &to)
            .map_err(|_| "A removed file could not be tucked into Backups.".to_string())?;
    }
    let mut manifest = load_manifest(&root)?;
    manifest
        .files
        .retain(|item| item.dropbox_path != dropbox_path);
    save_manifest(&root, &manifest)
}

/// A dictated idea, dated and dropped into 02 Working Files/Ideas — explicitly
/// non-canon until the author promotes it.
#[tauri::command]
pub fn save_idea_note(content: String) -> Result<String, String> {
    let trimmed = content.trim();
    if trimmed.is_empty() {
        return Err("Say or type the idea first.".to_string());
    }
    let root = initialize()?;
    let folder = root.join("02 Working Files").join("Ideas");
    fs::create_dir_all(&folder)
        .map_err(|_| "The Ideas folder could not be created.".to_string())?;
    let stamp = timestamp();
    let name = format!("Idea {stamp}.md");
    let body = format!("# Idea\n\n{trimmed}\n");
    write_copy(&folder.join(&name), body.as_bytes())?;
    Ok(format!("02 Working Files/Ideas/{name}"))
}

#[tauri::command]
pub fn open_project_workspace() -> Result<(), String> {
    let root = initialize()?;
    Command::new("explorer.exe")
        .arg(root)
        .spawn()
        .map(|_| ())
        .map_err(|_| "Windows could not open the local project folder.".to_string())
}

// ----- Project Explorer: read-only views over the downloaded local files -----

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDocument {
    dropbox_path: String,
    local_relative_path: String,
    revision_id: Option<String>,
    byte_count: usize,
    status: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    local_relative_path: String,
    match_count: usize,
    snippet: String,
}

/// Every file the workspace knows about (downloaded text and pending binaries).
#[tauri::command]
pub fn list_project_documents() -> Result<Vec<ProjectDocument>, String> {
    let root = workspace_root()?;
    if !manifest_path(&root).exists() {
        return Ok(Vec::new());
    }
    let manifest = load_manifest(&root)?;
    Ok(manifest
        .files
        .into_iter()
        .map(|file| ProjectDocument {
            dropbox_path: file.dropbox_path,
            local_relative_path: file.local_relative_path,
            revision_id: file.revision_id,
            byte_count: file.byte_count,
            status: file.status,
        })
        .collect())
}

fn checked_relative(local_relative_path: &str) -> Result<PathBuf, String> {
    let relative = Path::new(local_relative_path);
    if relative.as_os_str().is_empty()
        || relative
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
    {
        return Err("That project file path is unsafe.".to_string());
    }
    Ok(relative.to_path_buf())
}

/// Raw bytes of one workspace file — used for Word documents, which the
/// frontend renders itself. Read-only, path-checked, originals only.
#[tauri::command]
pub fn read_project_document_bytes(local_relative_path: String) -> Result<Vec<u8>, String> {
    let root = workspace_root()?;
    let relative = checked_relative(&local_relative_path)?;
    let full = root.join("01 Originals").join(relative);
    fs::read(&full)
        .map_err(|_| "That project file could not be read from the local workspace.".to_string())
}

/// Word documents sitting in 01 Originals (dropped in by hand or synced later).
/// They never appear in the text manifest, so the shelf asks for them here.
#[tauri::command]
pub fn list_workspace_docx() -> Result<Vec<String>, String> {
    let root = workspace_root()?.join("01 Originals");
    let mut found = Vec::new();
    let mut stack = vec![root.clone()];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = fs::read_dir(&dir) else { continue };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
            } else if path
                .extension()
                .and_then(|e| e.to_str())
                .is_some_and(|e| e.eq_ignore_ascii_case("docx"))
            {
                if let Ok(relative) = path.strip_prefix(&root) {
                    found.push(relative.to_string_lossy().replace('\\', "/"));
                }
            }
        }
    }
    found.sort();
    Ok(found)
}

/// Text files waiting in 05 Approved Uploads. Only what the owner placed there.
#[tauri::command]
pub fn list_approved_uploads() -> Result<Vec<String>, String> {
    let root = workspace_root()?.join("05 Approved Uploads");
    let mut found = Vec::new();
    let mut stack = vec![root.clone()];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = fs::read_dir(&dir) else { continue };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
            } else if let Ok(relative) = path.strip_prefix(&root) {
                found.push(relative.to_string_lossy().replace('\\', "/"));
            }
        }
    }
    found.sort();
    Ok(found)
}

#[tauri::command]
pub fn read_approved_upload(local_relative_path: String) -> Result<String, String> {
    let root = workspace_root()?;
    let relative = checked_relative(&local_relative_path)?;
    let full = root.join("05 Approved Uploads").join(relative);
    fs::read_to_string(&full)
        .map_err(|_| "That approved file could not be read as text. Word and other binary files cannot be uploaded yet.".to_string())
}

/// After a successful upload the file moves to 06 Exports/Uploaded so the
/// approved folder only ever holds work still waiting to go.
#[tauri::command]
pub fn archive_approved_upload(local_relative_path: String) -> Result<(), String> {
    let root = workspace_root()?;
    let relative = checked_relative(&local_relative_path)?;
    let from = root.join("05 Approved Uploads").join(&relative);
    let to = root.join("06 Exports").join("Uploaded").join(&relative);
    if let Some(parent) = to.parent() {
        fs::create_dir_all(parent).map_err(|_| "The uploaded-archive folder could not be created.".to_string())?;
    }
    fs::rename(&from, &to).map_err(|_| "The uploaded file could not be archived.".to_string())
}

/// The exact local original text of one downloaded file.
#[tauri::command]
pub fn read_project_document(local_relative_path: String) -> Result<String, String> {
    let root = workspace_root()?;
    let relative = checked_relative(&local_relative_path)?;
    let full = root.join("01 Originals").join(relative);
    fs::read_to_string(&full)
        .map_err(|_| "That project file could not be read from the local workspace.".to_string())
}

/// Case-insensitive content search across downloaded files. Returns each file
/// that mentions the query, how many times, and a one-line snippet. No AI used.
#[tauri::command]
pub fn search_project_documents(query: String) -> Result<Vec<SearchHit>, String> {
    let needle = query.trim().to_lowercase();
    if needle.is_empty() {
        return Ok(Vec::new());
    }
    let root = workspace_root()?;
    if !manifest_path(&root).exists() {
        return Ok(Vec::new());
    }
    let manifest = load_manifest(&root)?;
    let mut hits: Vec<SearchHit> = Vec::new();
    for file in manifest.files.iter().filter(|item| item.status == "downloaded") {
        let full = root.join("01 Originals").join(&file.local_relative_path);
        let content = match fs::read_to_string(&full) {
            Ok(value) => value,
            Err(_) => continue,
        };
        let lower = content.to_lowercase();
        let count = lower.matches(&needle).count();
        if count == 0 {
            continue;
        }
        let snippet = content
            .lines()
            .find(|line| line.to_lowercase().contains(&needle))
            .map(|line| {
                let trimmed = line.trim();
                if trimmed.chars().count() > 140 {
                    trimmed.chars().take(140).collect::<String>() + "…"
                } else {
                    trimmed.to_string()
                }
            })
            .unwrap_or_default();
        hits.push(SearchHit {
            local_relative_path: file.local_relative_path.clone(),
            match_count: count,
            snippet,
        });
    }
    hits.sort_by(|left, right| right.match_count.cmp(&left.match_count));
    Ok(hits)
}

#[cfg(test)]
mod tests {
    use super::safe_relative_path;

    #[test]
    fn accepts_only_paths_inside_the_project() {
        assert_eq!(
            safe_relative_path("/The Long Rot/Stories/Chapter 1.txt")
                .unwrap()
                .to_string_lossy(),
            "Stories/Chapter 1.txt"
        );
        assert!(safe_relative_path("/Other Project/file.txt").is_err());
        assert!(safe_relative_path("/The Long Rot/../secret.txt").is_err());
    }
}

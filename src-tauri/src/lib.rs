use std::fs;

#[derive(serde::Serialize)]
struct SlashCommand {
    name: String,
    description: String,
}

/// Read ~/.claude/commands/*.md and return name+description from YAML frontmatter.
#[tauri::command]
fn read_slash_commands() -> Vec<SlashCommand> {
    let home = std::env::var("HOME").unwrap_or_default();
    let dir = format!("{}/.claude/commands", home);
    let mut commands = Vec::new();

    let entries = match fs::read_dir(&dir) {
        Ok(e) => e,
        Err(_) => return commands,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("md") {
            continue;
        }
        let content = match fs::read_to_string(&path) {
            Ok(c) => c,
            Err(_) => continue,
        };
        if let Some(cmd) = parse_frontmatter(&content) {
            commands.push(cmd);
        }
    }

    commands.sort_by(|a, b| a.name.cmp(&b.name));
    commands
}

fn parse_frontmatter(content: &str) -> Option<SlashCommand> {
    let inner = content.strip_prefix("---\n")?.split("\n---").next()?;
    let name = inner.lines()
        .find(|l| l.starts_with("name:"))?
        .trim_start_matches("name:")
        .trim()
        .to_string();
    let desc_line = inner.lines()
        .find(|l| l.starts_with("description:"))?
        .trim_start_matches("description:")
        .trim()
        .trim_matches('"')
        .to_string();
    Some(SlashCommand { name, description: desc_line })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![read_slash_commands])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

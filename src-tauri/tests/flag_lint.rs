// Enforces flags-frontmatter parity for ~/.claude/skills/*/SKILL.md.
//
// Why this lives in pixel-terminal:
//   The Rust slash-menu parser (src/commands/misc.rs) reads frontmatter `flags:` only.
//   When a skill documents a new `### `--flag`` H3 in its body without updating
//   frontmatter, Anima's autocomplete silently loses that flag. This test shells
//   out to ~/.claude/scripts/lint_skill_flags.py and fails if drift exists.
//
// Skip conditions (so CI containers without a populated ~/.claude don't false-fail):
//   - script missing
//   - skills dir missing
//   - skills dir empty
//
// On the developer machine, this runs every `cargo test` and blocks commits when
// a skill drifts.

use std::path::PathBuf;
use std::process::Command;

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from)
}

#[test]
fn skill_flag_frontmatter_matches_body() {
    let home = match home_dir() {
        Some(h) => h,
        None => {
            eprintln!("[flag_lint] HOME unset — skipping");
            return;
        }
    };

    let script = home.join(".claude/scripts/lint_skill_flags.py");
    if !script.exists() {
        eprintln!(
            "[flag_lint] {} missing — skipping (install from repo to enable)",
            script.display()
        );
        return;
    }

    let skills = home.join(".claude/skills");
    if !skills.exists() {
        eprintln!("[flag_lint] {} missing — skipping (CI container?)", skills.display());
        return;
    }
    let has_any = std::fs::read_dir(&skills)
        .map(|rd| rd.flatten().any(|e| e.path().is_dir()))
        .unwrap_or(false);
    if !has_any {
        eprintln!("[flag_lint] {} empty — skipping", skills.display());
        return;
    }

    let output = Command::new("python3")
        .arg(&script)
        .output()
        .expect("failed to spawn python3 lint_skill_flags.py");

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);

    if !output.status.success() {
        panic!(
            "Flag-frontmatter drift detected in ~/.claude/skills/.\n\
             Fix with: python3 ~/.claude/scripts/lint_skill_flags.py --fix\n\n\
             --- stdout ---\n{}\n--- stderr ---\n{}",
            stdout, stderr
        );
    }
}

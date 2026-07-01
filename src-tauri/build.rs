use std::process::Command;

/// Run a git command from the crate root and return trimmed stdout, or None
/// if git isn't available / this isn't a git checkout (e.g. a source tarball).
fn git_output(args: &[&str]) -> Option<String> {
    let out = Command::new("git").args(args).output().ok()?;
    if !out.status.success() {
        return None;
    }
    let s = String::from_utf8(out.stdout).ok()?.trim().to_string();
    if s.is_empty() { None } else { Some(s) }
}

fn main() {
    // Embed the current commit hash + commit date at compile time so dev
    // builds can show "what am I actually running" instead of a version
    // number that doesn't change between local rebuilds. Falls back
    // gracefully if git isn't available (e.g. building from a release
    // tarball without a .git directory).
    let hash = git_output(&["rev-parse", "--short", "HEAD"]).unwrap_or_else(|| "unknown".into());
    let date = git_output(&["log", "-1", "--format=%cI"]).unwrap_or_else(|| "unknown".into());
    println!("cargo:rustc-env=CATALYST_GIT_HASH={hash}");
    println!("cargo:rustc-env=CATALYST_GIT_DATE={date}");
    // Best-effort rebuild trigger when HEAD moves (new commit/checkout).
    // Not watching individual ref files since the branch name isn't known
    // here — a few seconds of staleness immediately after a commit (until
    // the next unrelated rebuild) is an acceptable trade-off.
    println!("cargo:rerun-if-changed=../.git/HEAD");

    tauri_build::build()
}

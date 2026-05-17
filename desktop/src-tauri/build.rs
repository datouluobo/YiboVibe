use std::env;
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

fn git_output(args: &[&str]) -> Option<String> {
    let output = Command::new("git").args(args).output().ok()?;
    if !output.status.success() {
        return None;
    }

    let value = String::from_utf8(output.stdout).ok()?;
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn main() {
    println!("cargo:rerun-if-changed=../../.git/HEAD");
    println!("cargo:rerun-if-changed=../../.git/index");
    println!("cargo:rerun-if-env-changed=CARGO_TARGET_DIR");

    let git_commit =
        git_output(&["rev-parse", "--short=12", "HEAD"]).unwrap_or_else(|| "unknown".to_string());
    let git_dirty = git_output(&["status", "--porcelain"])
        .map(|status| !status.is_empty())
        .unwrap_or(false);
    let build_unix_ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs().to_string())
        .unwrap_or_else(|_| "0".to_string());
    let profile = env::var("PROFILE").unwrap_or_else(|_| "unknown".to_string());
    let target_dir =
        env::var("CARGO_TARGET_DIR").unwrap_or_else(|_| "<default-target>".to_string());
    let build_id = format!(
        "{}-{}-{}",
        git_commit,
        if git_dirty { "dirty" } else { "clean" },
        build_unix_ts
    );

    println!("cargo:rustc-env=YIBOVIBE_BUILD_ID={build_id}");
    println!("cargo:rustc-env=YIBOVIBE_BUILD_GIT_COMMIT={git_commit}");
    println!(
        "cargo:rustc-env=YIBOVIBE_BUILD_GIT_DIRTY={}",
        if git_dirty { "1" } else { "0" }
    );
    println!("cargo:rustc-env=YIBOVIBE_BUILD_UNIX_TS={build_unix_ts}");
    println!("cargo:rustc-env=YIBOVIBE_BUILD_PROFILE={profile}");
    println!("cargo:rustc-env=YIBOVIBE_BUILD_TARGET_DIR={target_dir}");

    tauri_build::build()
}

#!/usr/bin/env python3
"""Split lib.rs into modules under commands/"""
import sys

lib_path = sys.argv[1] if len(sys.argv) > 1 else "src-tauri/src/lib.rs"
with open(lib_path) as f:
    lines = f.readlines()

def extract(start, end):
    """Extract lines [start, end) 1-indexed, inclusive start, exclusive end"""
    return "".join(lines[start-1:end-1])

def write_module(name, ranges, imports=""):
    """Write a module file from multiple ranges"""
    content = imports + "\n"
    for s, e in ranges:
        content += extract(s, e).rstrip() + "\n\n"
    path = f"src-tauri/src/commands/{name}.rs"
    with open(path, "w") as f:
        f.write(content.strip() + "\n")
    print(f"  wrote {path} ({len(content.splitlines())} lines)")

# === 1. plugin.rs ===
write_module("plugin", [(28, 99)], 
    "use serde_json;\n")

# === 2. clipboard.rs ===
write_module("clipboard", [(118, 129)])

# === 3. tools.rs ===
write_module("tools", [(131, 609)], 
    "use std::env;\nuse std::path::{Path, PathBuf};\nuse tauri;\n")

# === 4. opencode.rs === (big: structs + helpers + commands)
write_module("opencode", [(609, 1129)], 
    "use base64::{engine::general_purpose, Engine as _};\nuse serde::{Deserialize, Serialize};\nuse std::collections::HashMap;\nuse std::net::TcpListener;\nuse std::path::{Path, PathBuf};\nuse std::process::{Command as StdCommand, Stdio};\nuse std::time::{Instant, SystemTime, UNIX_EPOCH};\nuse tauri::{ipc::Channel, Emitter, Manager, State};\nuse tokio::io::{AsyncBufReadExt, AsyncReadExt, BufReader};\nuse tokio::process::Command;\nuse tokio::sync::Mutex;\nuse tokio::time::{timeout, Duration};\n")

# === 5. session.rs ===
write_module("session", [(1589, 1712)],
    "use serde::Deserialize;\nuse std::path::PathBuf;\n")

# === 6. greet.rs ===
write_module("greet", [(1647, 1666)],
    "use base64::{engine::general_purpose, Engine as _};\nuse serde::{Deserialize, Serialize};\nuse std::path::PathBuf;\n")

# === 7. dev.rs === (structs + helpers + commands + dev_run_command)
write_module("dev", [
    (1129, 1240),   # dev input structs + SkillMaterial structs
    (1321, 1409),   # dev output structs
    (1581, 1588),   # SaveGeneratedFileOutput
    (1666, 2245),   # dev helpers + commands
    (4448, 4477),   # dev_run_command
],
    "use base64::{engine::general_purpose, Engine as _};\nuse serde::{Deserialize, Serialize};\nuse std::collections::VecDeque;\nuse std::path::{Component, Path, PathBuf};\nuse std::process::{Command as StdCommand, Stdio};\n")

# === 8. media.rs === (media/doc structs + helpers + commands)
write_module("media", [
    (1240, 1321),   # media input structs
    (1409, 1581),   # media/doc output structs + MarkdownConversion + ConversionJobs + MediaCaptureJobs + SaveGeneratedFileInput
    (2245, 4448),   # media helpers + commands
],
    "use base64::{engine::general_purpose, Engine as _};\nuse serde::{Deserialize, Serialize};\nuse std::collections::{HashMap, HashSet};\nuse std::path::{Path, PathBuf};\nuse std::process::{Command as StdCommand, Stdio};\nuse std::time::{Instant, SystemTime, UNIX_EPOCH};\nuse tauri::{Emitter, Manager, State};\nuse tokio::io::{AsyncBufReadExt, BufReader};\nuse tokio::process::Command;\nuse tokio::sync::Mutex;\nuse tokio::time::{timeout, Duration};\nuse tauri_plugin_dialog::DialogExt;\n")

# === 9. obsidian.rs ===
write_module("obsidian", [(4791, 4831)],
    "use std::process::Command;\n")

# === 10. skill_material.rs ===
write_module("skill_material", [(4477, 4791)],
    "use serde::{Deserialize, Serialize};\nuse std::collections::HashMap;\nuse std::path::{Path, PathBuf};\nuse std::process::Stdio;\nuse std::time::Instant;\nuse tokio::io::{AsyncBufReadExt, BufReader};\nuse tokio::process::Command;\nuse tokio::time::{timeout, Duration};\n")

# === Now write new lib.rs ===
new_lib = """use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::env;
use std::ffi::OsStr;
use std::path::{Path, PathBuf};
use tauri::{Emitter, Manager, WebviewWindowBuilder};
use tauri_plugin_dialog::DialogExt;
use tokio::sync::Mutex;
use tokio::time::{timeout, Duration};

mod commands;
mod secure_store;
mod skills;

// ─── NewAPI 登录回调拦截 ───

fn is_workbench_return_url(url: &tauri::Url) -> bool {
    matches!(
        url.host_str(),
        Some("jiucaihezi.studio")
            | Some("www.jiucaihezi.studio")
            | Some("dazi.studio")
            | Some("www.dazi.studio")
    )
}

fn workbench_url_from_return(url: &tauri::Url) -> tauri::Url {
    let query = url.query().map(|q| format!("?{q}")).unwrap_or_default();
    tauri::Url::parse(&format!("tauri://localhost/{query}"))
        .expect("valid local workbench entry url")
}

// ─── App entry ───

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(commands::media::ConversionJobs::default())
        .manage(commands::opencode::OpenCodeRuntime::default())
        .setup(|app| {
            let window = app
                .get_webview_window("main")
                .expect("main window not found");
            window
                .clone()
                .on_navigation(|url| {
                    if is_workbench_return_url(url) {
                        let resolved = workbench_url_from_return(url);
                        let label = window.label().to_string();
                        tauri::WebviewWindowBuilder::new(app, &label, tauri::WebviewUrl::External(resolved))
                            .build()
                            .map(|_| ())
                            .ok();
                        return false;
                    }
                    true
                });

            // Plugin CSS hot-reload
            #[cfg(debug_assertions)]
            {
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    let home = std::env::var("HOME").unwrap_or_default();
                    let plugins_dir = std::path::PathBuf::from(home)
                        .join(".jiucaihezi")
                        .join("plugins");
                    let _ = std::fs::create_dir_all(&plugins_dir);
                    let mut last_modified = std::time::SystemTime::now();
                    loop {
                        std::thread::sleep(std::time::Duration::from_secs(1));
                        if let Ok(entries) = std::fs::read_dir(&plugins_dir) {
                            for entry in entries.flatten() {
                                if let Ok(meta) = entry.metadata() {
                                    if let Ok(mod_time) = meta.modified() {
                                        if mod_time > last_modified {
                                            last_modified = mod_time;
                                            let _ = handle.emit("plugin-css-changed", ());
                                            break;
                                        }
                                    }
                                }
                            }
                        }
                    }
                });
            }

            // ponytail: 延迟 Skills 扫描，不阻塞启动
            let app_handle = app.handle().clone();
            tokio::spawn(async move {
                tokio::time::sleep(Duration::from_millis(200)).await;
                let _ = skills::scanner::scan_all_skills(app_handle.clone());
                app_handle.manage(skills::SkillsAppState {
                    skills_db_path: skills::settings::get_skills_database_path(&app_handle),
                });
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::greet::greet,
            commands::session::read_session_token,
            commands::session::write_session_token,
            commands::clipboard::write_clipboard_text,
            commands::tools::check_whisper_available,
            commands::http::http_request,
            commands::http::http_download_base64,
            commands::http::http_request_stream,
            secure_store::get_api_key,
            secure_store::set_api_key,
            secure_store::clear_api_key,
            secure_store::get_gateway_session_token,
            secure_store::set_gateway_session_token,
            secure_store::clear_gateway_session_token,
            commands::opencode::opencode_mcp_status,
            commands::opencode::opencode_ensure_server,
            commands::opencode::opencode_stop,
            commands::opencode::opencode_status,
            commands::opencode::open_in_shell,
            commands::media::save_generated_file,
            commands::dev::dev_detect_project,
            commands::dev::dev_list_files,
            commands::dev::dev_search_text,
            commands::dev::dev_read_file,
            commands::dev::dev_read_many_files,
            commands::dev::dev_write_file,
            commands::dev::dev_write_file_bytes,
            commands::dev::dev_rename_file,
            commands::dev::dev_delete_file,
            commands::dev::dev_create_dir,
            commands::dev::dev_reveal_in_finder,
            commands::dev::dev_replace_in_file,
            commands::dev::dev_get_diff,
            commands::dev::dev_run_command,
            commands::skill_material::skill_material_compile,
            commands::media::media_cache_file,
            commands::media::document_to_markdown_file,
            commands::media::document_path_to_markdown_file,
            commands::media::cancel_markdown_conversion,
            commands::media::media_select_file,
            commands::media::media_inspect_file,
            commands::media::media_process_file,
            commands::media::media_transcribe_file,
            commands::media::media_burn_subtitles,
            commands::plugin::plugin_install_npm,
            commands::plugin::plugin_read_manifest,
            commands::plugin::plugin_read_config,
            commands::plugin::plugin_write_config,
            skills::scanner::scan_all_skills,
            skills::agents::get_agents,
            skills::agents::detect_agents,
            skills::agents::add_custom_agent,
            skills::agents::update_custom_agent,
            skills::agents::remove_custom_agent,
            skills::linker::install_skill_to_agent,
            skills::linker::uninstall_skill_from_agent,
            skills::linker::batch_install_to_agents,
            skills::skills::get_skills_by_agent,
            skills::skills::get_central_skills,
            skills::skills::save_central_skill,
            skills::skills::get_central_skill_bundles,
            skills::skills::get_central_skill_bundle_detail,
            skills::skills::preview_delete_central_skill_bundle,
            skills::skills::delete_central_skill_bundle,
            skills::skills::delete_central_skill,
            skills::skills::get_skill_detail,
            skills::skills::read_skill_content,
            skills::skills::read_file_by_path,
            skills::skills::list_skill_directory,
            skills::skills::open_in_file_manager,
            skills::collections::create_collection,
            skills::collections::get_collections,
            skills::collections::get_collection_detail,
            skills::collections::add_skill_to_collection,
            skills::collections::remove_skill_from_collection,
            skills::collections::delete_collection,
            skills::collections::update_collection,
            skills::collections::batch_install_collection,
            skills::collections::export_collection,
            skills::collections::import_collection,
            skills::settings::get_scan_directories,
            skills::settings::add_scan_directory,
            skills::settings::remove_scan_directory,
            skills::settings::set_scan_directory_active,
            skills::settings::get_setting,
            skills::settings::set_setting,
            skills::settings::get_skills_database_path,
            skills::discover::discover_scan_roots,
            skills::discover::get_scan_roots,
            skills::discover::get_obsidian_vaults,
            skills::discover::get_obsidian_vault_skills,
            skills::discover::set_scan_root_enabled,
            skills::discover::start_project_scan,
            skills::discover::stop_project_scan,
            skills::discover::get_discovered_skills,
            skills::discover::import_discovered_skill_to_central,
            skills::discover::import_discovered_skill_to_platform,
            skills::discover::clear_discovered_skills,
            skills::github_import::preview_github_repo_import,
            skills::github_import::import_github_repo_skills,
            skills::github_import::fetch_github_skill_markdown,
            skills::marketplace::list_registries,
            skills::marketplace::add_registry,
            skills::marketplace::remove_registry,
            skills::marketplace::sync_registry,
            skills::marketplace::sync_registry_with_options,
            skills::marketplace::search_marketplace_skills,
            skills::marketplace::install_marketplace_skill,
            skills::marketplace::explain_skill,
            skills::marketplace::get_skill_explanation,
            skills::marketplace::explain_skill_stream,
            skills::marketplace::refresh_skill_explanation,
            commands::obsidian::check_obsidian_installed,
            commands::obsidian::mdfind_obsidian,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
"""

with open(lib_path, "w") as f:
    f.write(new_lib)
print(f"  wrote {lib_path} ({len(new_lib.splitlines())} lines)")
print("Done!")

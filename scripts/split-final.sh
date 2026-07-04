#!/bin/bash
set -e
L=src-tauri/src/lib.rs
D=src-tauri/src/commands

echo "=== 1. Extracting modules ==="

# plugin.rs (28-100)
sed -n '28,100p' $L > $D/plugin.rs
echo "  plugin: $(wc -l < $D/plugin.rs) lines"

# clipboard.rs (118-130) 
sed -n '118,130p' $L > $D/clipboard.rs
echo "  clipboard: $(wc -l < $D/clipboard.rs) lines"

# tools.rs (131-608) - with pub(crate) markers
sed -n '131,608p' $L | sed -E '
    s/^fn (resolve_local_binary\b)/pub(crate) fn \1/
    s/^fn (resolve_local_binary_option\b)/pub(crate) fn \1/
    s/^fn (resolve_app_media_binary\b)/pub(crate) fn \1/
    s/^fn (media_tool_resource_names\b)/pub(crate) fn \1/
    s/^fn (resolve_local_python\b)/pub(crate) fn \1/
    s/^fn (local_tools_python_path\b)/pub(crate) fn \1/
    s/^fn (python_path_from_token\b)/pub(crate) fn \1/
    s/^fn (python_from_wrapper_script\b)/pub(crate) fn \1/
' > $D/tools.rs
echo "  tools: $(wc -l < $D/tools.rs) lines"

# opencode.rs (609-1186) - with pub(crate) markers + imports
{
    echo 'use base64::engine::general_purpose;'
    echo 'use base64::Engine as _;'
    echo 'use serde::{Deserialize, Serialize};'
    echo 'use std::collections::HashMap;'
    echo 'use std::env;'
    echo 'use std::ffi::OsStr;'
    echo 'use std::net::TcpListener;'
    echo 'use std::path::{Path, PathBuf};'
    echo 'use std::process::{Command as StdCommand, Stdio};'
    echo 'use std::time::{SystemTime, UNIX_EPOCH};'
    echo 'use tauri::{ipc::Channel, Emitter, Manager, State};'
    echo 'use tokio::io::{AsyncBufReadExt, AsyncReadExt, BufReader};'
    echo 'use tokio::process::Command;'
    echo 'use tokio::sync::Mutex;'
    echo 'use tokio::time::{timeout, Duration};'
    echo 'use crate::commands::tools::{resolve_local_binary, resolve_app_media_binary, resolve_local_python, local_tools_python_path, opencode_platform_package_dir, opencode_resource_names, existing_file, resolve_opencode_binary_from_inputs, app_executable_dir, ensure_binary_executable, opencode_resource_dirs, resolve_opencode_binary, media_tool_resource_names};'
    echo ''
    sed -n '609,1186p' $L | sed -E '
        s/^fn (open_path_with_system\b)/pub(crate) fn \1/
        s/^fn (user_home_dir\b)/pub(crate) fn \1/
        s/^struct (OpenCodeRuntime\b)/pub(crate) struct \1/
    '
} > $D/opencode.rs
echo "  opencode: $(wc -l < $D/opencode.rs) lines"

# session.rs (1586-1646) - imports user_home_dir from opencode
{
    echo 'use serde::Deserialize;'
    echo 'use std::path::PathBuf;'
    echo 'use crate::commands::opencode::user_home_dir;'
    echo ''
    sed -n '1586,1646p' $L
} > $D/session.rs
echo "  session: $(wc -l < $D/session.rs) lines"

# greet.rs (1647-1666) - imports SaveGeneratedFileInput/Output from dev
{
    echo 'use base64::engine::general_purpose;'
    echo 'use base64::Engine as _;'
    echo 'use serde::{Deserialize, Serialize};'
    echo 'use std::path::PathBuf;'
    echo 'use crate::commands::dev::{SaveGeneratedFileInput, SaveGeneratedFileOutput};'
    echo ''
    sed -n '1647,1666p' $L
} > $D/greet.rs
echo "  greet: $(wc -l < $D/greet.rs) lines"

# dev.rs - structs + helpers + commands + dev_run_command
{
    echo 'use base64::engine::general_purpose;'
    echo 'use base64::Engine as _;'
    echo 'use serde::{Deserialize, Serialize};'
    echo 'use std::collections::VecDeque;'
    echo 'use std::path::{Component, Path, PathBuf};'
    echo 'use std::process::{Command as StdCommand, Stdio};'
    echo 'use crate::commands::opencode::open_path_with_system;'
    echo ''
    # Dev input structs + output structs + SaveGeneratedFileInput/Output
    for r in '1187,1238' '1255,1297' '1377,1467' '1520,1535'; do
        sed -n "${r}p" $L
    done | sed -E '
        s/^fn (canonical_root\b)/pub(crate) fn \1/
        s/^fn (clean_relative_path\b)/pub(crate) fn \1/
        s/^fn (resolve_existing_path\b)/pub(crate) fn \1/
        s/^fn (resolve_write_path\b)/pub(crate) fn \1/
        s/^fn (display_relative\b)/pub(crate) fn \1/
        s/^struct (SaveGeneratedFileInput\b)/pub(crate) struct \1/
        s/^struct (SaveGeneratedFileOutput\b)/pub(crate) struct \1/
    '
    # Dev helpers + commands (1667-2544) + dev_run_command (4449-4477)
    for r in '1667,2544' '4449,4477'; do
        sed -n "${r}p" $L
    done
} > $D/dev.rs
echo "  dev: $(wc -l < $D/dev.rs) lines"

# media.rs - structs + helpers + commands
{
    echo 'use base64::engine::general_purpose;'
    echo 'use base64::Engine as _;'
    echo 'use serde::{Deserialize, Serialize};'
    echo 'use std::collections::{HashMap, HashSet};'
    echo 'use std::env;'
    echo 'use std::path::{Component, Path, PathBuf};'
    echo 'use std::process::{Command as StdCommand, Stdio};'
    echo 'use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};'
    echo 'use tauri::{Emitter, Manager, State};'
    echo 'use tokio::io::{AsyncBufReadExt, AsyncReadExt, BufReader};'
    echo 'use tokio::process::Command;'
    echo 'use tokio::sync::Mutex;'
    echo 'use tokio::time::{timeout, Duration as TokioDuration};'
    echo 'use tauri_plugin_dialog::DialogExt;'
    echo 'use crate::commands::tools::{resolve_local_binary, resolve_app_media_binary, resolve_local_python, local_tools_python_path};'
    echo 'use crate::commands::opencode::user_home_dir;'
    echo 'use crate::commands::dev::SaveGeneratedFileInput;'
    echo ''
    for r in '1297,1376' '1469,1520' '2545,4448'; do
        sed -n "${r}p" $L
    done
} > $D/media.rs
echo "  media: $(wc -l < $D/media.rs) lines"

# skill_material.rs
{
    echo 'use serde::{Deserialize, Serialize};'
    echo 'use std::collections::HashMap;'
    echo 'use std::path::{Component, Path, PathBuf};'
    echo 'use std::process::Stdio;'
    echo 'use std::time::Instant;'
    echo 'use tokio::io::{AsyncBufReadExt, BufReader};'
    echo 'use tokio::process::Command;'
    echo 'use tokio::time::{timeout, Duration};'
    echo 'use crate::commands::tools::{resolve_local_binary, resolve_local_python};'
    echo 'use crate::commands::dev::canonical_root;'
    echo ''
    for r in '1239,1254' '1412,1421' '4479,4790'; do
        sed -n "${r}p" $L
    done
} > $D/skill_material.rs
echo "  skill_material: $(wc -l < $D/skill_material.rs) lines"

# obsidian.rs (4779-4840)
sed -n '4779,4840p' $L > $D/obsidian.rs
echo "  obsidian: $(wc -l < $D/obsidian.rs) lines"

echo ""
echo "=== 2. Writing new lib.rs ==="
cat > $L << 'RUSTEOF'
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use tauri::{Emitter, Manager, WebviewWindowBuilder};
use tokio::time::Duration;

mod commands;
mod secure_store;
mod skills;

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(commands::media::ConversionJobs::default())
        .manage(commands::opencode::OpenCodeRuntime::default())
        .setup(|app| {
            let window = app
                .get_webview_window("main")
                .expect("main window not found");
            window.clone().on_navigation(|url| {
                if is_workbench_return_url(url) {
                    let resolved = workbench_url_from_return(url);
                    let label = window.label().to_string();
                    tauri::WebviewWindowBuilder::new(
                        app,
                        &label,
                        tauri::WebviewUrl::External(resolved),
                    )
                    .build()
                    .map(|_| ())
                    .ok();
                    return false;
                }
                true
            });

            #[cfg(debug_assertions)]
            {
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    let home = std::env::var("HOME").unwrap_or_default();
                    let plugins_dir =
                        std::path::PathBuf::from(home).join(".jiucaihezi").join("plugins");
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
            commands::tools::check_tool_installed,
            commands::tools::check_opencode_plugin,
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
            commands::dev::scaffold_vault,
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
RUSTEOF

echo ""
echo "=== Done ==="
echo "lib.rs: $(wc -l < $L) lines"
for f in $D/*.rs; do echo "  $(basename $f): $(wc -l < $f) lines"; done

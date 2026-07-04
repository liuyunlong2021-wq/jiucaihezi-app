#!/usr/bin/env python3
"""Split lib.rs (6229-line) into modules. Careful ranges, one-shot."""
import sys, os

lib_path = sys.argv[1] if len(sys.argv) > 1 else "src-tauri/src/lib.rs"
with open(lib_path) as f:
    lines = f.readlines()

def extract(start, end):
    """1-indexed, inclusive start, exclusive end"""
    return "".join(lines[start-1:end-1])

def write_module(name, ranges, imports=""):
    content = imports.rstrip() + "\n\n"
    for s, e in ranges:
        content += extract(s, e).rstrip() + "\n\n"
    path = f"src-tauri/src/commands/{name}.rs"
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        f.write(content.strip() + "\n")
    print(f"  {name}.rs: {len(content.splitlines())} lines")

# === Ranges for 6229-line lib.rs ===

# plugin: 28-100 (after mod skills, before is_workbench_return_url)
write_module("plugin", [(28, 100)], "use serde_json;\n")

# clipboard: 117-130
write_module("clipboard", [(117, 130)])

# tools: 130-609 (check_whisper through resolve_local_python)
write_module("tools", [(130, 609)])

# opencode: 609-1198 (open_in_shell through end of opencode_ensure_server)
write_module("opencode", [(609, 1198)],
    "use base64::engine::general_purpose;\nuse base64::Engine as _;\nuse serde::{Deserialize, Serialize};\nuse std::collections::HashMap;\nuse std::env;\nuse std::ffi::OsStr;\nuse std::net::TcpListener;\nuse std::path::{Path, PathBuf};\nuse std::process::{Command as StdCommand, Stdio};\nuse std::time::{SystemTime, UNIX_EPOCH};\nuse tauri::{ipc::Channel, Emitter, Manager, State};\nuse tokio::io::{AsyncBufReadExt, AsyncReadExt, BufReader};\nuse tokio::process::Command;\nuse tokio::sync::Mutex;\nuse tokio::time::{timeout, Duration};\n")

# session: 1655-1714 (jiucaihezi_home_dir through write_session_token)
write_module("session", [(1655, 1714)],
    "use serde::Deserialize;\nuse std::path::PathBuf;\n")

# greet: 1958-1979 (greet + save_generated_file)
write_module("greet", [(1958, 1979)],
    "use base64::engine::general_purpose;\nuse base64::Engine as _;\nuse serde::{Deserialize, Serialize};\nuse std::path::PathBuf;\n")

# dev: structs(1198-1248,1268-1310,1390-1424,1443-1479,1643-1651) + helpers+commands(1979-2556) + dev_run(4760-4791)
write_module("dev", [
    (1198, 1248), (1268, 1310),  # dev input structs (skip SkillMaterial 1248-1267)
    (1390, 1424), (1443, 1479),  # dev output structs (skip SkillMaterial 1424-1443)
    (1643, 1655),                # SaveGeneratedFileOutput struct
    (1979, 2556),                # canonical_root through end of dev_get_diff
    (2387, 2393),                # DevRenameInput (was inline, already in 1979-2556)
    (2407, 2412),                # DevDeleteInput (was inline, already in 1979-2556)
    (4760, 4791),                # dev_run_command
],
    "use base64::engine::general_purpose;\nuse base64::Engine as _;\nuse serde::{Deserialize, Serialize};\nuse std::collections::VecDeque;\nuse std::path::{Component, Path, PathBuf};\nuse std::process::{Command as StdCommand, Stdio};\n")

# media: structs(1310-1390,1479-1643,1643-1655-SaveGeneratedFileInput) + helpers+commands(2556-4760)
write_module("media", [
    (1310, 1390),                # media/doc input structs
    (1479, 1643),                # media/doc output + ConversionJobs + MediaCaptureJobs
    (2556, 4760),                # app_media_dir through media_burn_subtitles
],
    "use base64::engine::general_purpose;\nuse base64::Engine as _;\nuse serde::{Deserialize, Serialize};\nuse std::collections::{HashMap, HashSet};\nuse std::env;\nuse std::path::{Component, Path, PathBuf};\nuse std::process::{Command as StdCommand, Stdio};\nuse std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};\nuse tauri::{Emitter, Manager, State};\nuse tokio::io::{AsyncBufReadExt, AsyncReadExt, BufReader};\nuse tokio::process::Command;\nuse tokio::sync::Mutex;\nuse tokio::time::{timeout, Duration as TokioDuration};\nuse tauri_plugin_dialog::DialogExt;\n")

# skill_material: structs(1248-1268,1424-1443) + helpers+command(4791-5103)
write_module("skill_material", [
    (1248, 1268),                # SkillMaterialSourceInput + SkillMaterialCompileInput
    (1424, 1443),                # SkillMaterialRawFile + SkillMaterialCompileOutput
    (4791, 5103),                # SkillMaterialCommandSpec through skill_material_compile
],
    "use serde::{Deserialize, Serialize};\nuse std::collections::HashMap;\nuse std::path::{Component, Path, PathBuf};\nuse std::process::Stdio;\nuse std::time::Instant;\nuse tokio::io::{AsyncBufReadExt, BufReader};\nuse tokio::process::Command;\nuse tokio::time::{timeout, Duration};\n")

# obsidian: 5103-5156
write_module("obsidian", [(5103, 5156)],
    "use std::path::Path;\n")

# http: already done manually, skip
print("  http.rs: (already exists, skipping)")

# === Build new lib.rs ===
# We need: is_workbench_return_url (100-116), pub fn run (5923-end)
# Plus a few shared items from the old file that modules depend on

new_lib_lines = []
# imports (1-27)
new_lib_lines.append("".join(lines[0:27]).rstrip())
new_lib_lines.append("")
new_lib_lines.append("mod commands;")
new_lib_lines.append("mod secure_store;")
new_lib_lines.append("mod skills;")
new_lib_lines.append("")

# is_workbench_return_url + workbench_url_from_return (100-117)
new_lib_lines.append(extract(100, 117).rstrip())
new_lib_lines.append("")

# pub fn run (5923-end)
run_lines = extract(5923, len(lines))
# Fix: replace function names with module paths in generate_handler
# The old handler references just names; we need commands::module::name
run_lines = run_lines.replace(
    "            greet,",
    "            commands::greet::greet,"
).replace(
    "            read_session_token,",
    "            commands::session::read_session_token,"
).replace(
    "            write_session_token,",
    "            commands::session::write_session_token,"
).replace(
    "            write_clipboard_text,",
    "            commands::clipboard::write_clipboard_text,"
).replace(
    "            check_whisper_available,",
    "            commands::tools::check_whisper_available,"
).replace(
    "            http_request,",
    "            commands::http::http_request,"
).replace(
    "            http_download_base64,",
    "            commands::http::http_download_base64,"
).replace(
    "            http_request_stream,",
    "            commands::http::http_request_stream,"
).replace(
    "            opencode_mcp_status,",
    "            commands::opencode::opencode_mcp_status,"
).replace(
    "            opencode_ensure_server,",
    "            commands::opencode::opencode_ensure_server,"
).replace(
    "            opencode_stop,",
    "            commands::opencode::opencode_stop,"
).replace(
    "            opencode_status,",
    "            commands::opencode::opencode_status,"
).replace(
    "            save_generated_file,",
    "            commands::media::save_generated_file,"
).replace(
    "            dev_detect_project,",
    "            commands::dev::dev_detect_project,"
).replace(
    "            dev_list_files,",
    "            commands::dev::dev_list_files,"
).replace(
    "            dev_search_text,",
    "            commands::dev::dev_search_text,"
).replace(
    "            dev_read_file,",
    "            commands::dev::dev_read_file,"
).replace(
    "            dev_read_many_files,",
    "            commands::dev::dev_read_many_files,"
).replace(
    "            dev_write_file,",
    "            commands::dev::dev_write_file,"
).replace(
    "            dev_write_file_bytes,",
    "            commands::dev::dev_write_file_bytes,"
).replace(
    "            dev_rename_file,",
    "            commands::dev::dev_rename_file,"
).replace(
    "            dev_delete_file,",
    "            commands::dev::dev_delete_file,"
).replace(
    "            dev_create_dir,",
    "            commands::dev::dev_create_dir,"
).replace(
    "            dev_reveal_in_finder,",
    "            commands::dev::dev_reveal_in_finder,"
).replace(
    "            scaffold_vault,",
    "            commands::dev::scaffold_vault,"
).replace(
    "            dev_replace_in_file,",
    "            commands::dev::dev_replace_in_file,"
).replace(
    "            dev_get_diff,",
    "            commands::dev::dev_get_diff,"
).replace(
    "            dev_run_command,",
    "            commands::dev::dev_run_command,"
).replace(
    "            skill_material_compile,",
    "            commands::skill_material::skill_material_compile,"
).replace(
    "            media_cache_file,",
    "            commands::media::media_cache_file,"
).replace(
    "            document_to_markdown_file,",
    "            commands::media::document_to_markdown_file,"
).replace(
    "            document_path_to_markdown_file,",
    "            commands::media::document_path_to_markdown_file,"
).replace(
    "            cancel_markdown_conversion,",
    "            commands::media::cancel_markdown_conversion,"
).replace(
    "            media_select_file,",
    "            commands::media::media_select_file,"
).replace(
    "            media_inspect_file,",
    "            commands::media::media_inspect_file,"
).replace(
    "            media_process_file,",
    "            commands::media::media_process_file,"
).replace(
    "            media_transcribe_file,",
    "            commands::media::media_transcribe_file,"
).replace(
    "            media_burn_subtitles,",
    "            commands::media::media_burn_subtitles,"
).replace(
    "            plugin_install_npm,",
    "            commands::plugin::plugin_install_npm,"
).replace(
    "            plugin_read_manifest,",
    "            commands::plugin::plugin_read_manifest,"
).replace(
    "            plugin_read_config,",
    "            commands::plugin::plugin_read_config,"
).replace(
    "            plugin_write_config,",
    "            commands::plugin::plugin_write_config,"
).replace(
    "            check_tool_installed,",
    "            commands::tools::check_tool_installed,"
).replace(
    "            check_opencode_plugin,",
    "            commands::tools::check_opencode_plugin,"
).replace(
    "            check_obsidian_installed,",
    "            commands::obsidian::check_obsidian_installed,"
).replace(
    "            mdfind_obsidian,",
    "            commands::obsidian::mdfind_obsidian,",
)

# Fix .manage references
run_lines = run_lines.replace(
    "ConversionJobs::default()",
    "commands::media::ConversionJobs::default()"
).replace(
    "OpenCodeRuntime::default()",
    "commands::opencode::OpenCodeRuntime::default()"
)

# Fix open_in_shell
run_lines = run_lines.replace(
    "            open_in_shell,",
    "            commands::opencode::open_in_shell,"
)

new_lib_lines.append(run_lines.rstrip())
new_lib_lines.append("")

new_content = "\n".join(new_lib_lines)
with open(lib_path, "w") as f:
    f.write(new_content)

print(f"\nlib.rs: {len(new_content.splitlines())} lines")
print("Done!")

// 抑制已知无害的编译警告（跨平台条件编译 / 预留接口 / 测试辅助）
#![allow(unused_imports, dead_code, private_interfaces)]

use base64::Engine as _;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::env;
#[allow(unused_imports)]
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command as StdCommand;
use std::time::Instant;
use tauri::{webview::NewWindowResponse, Manager, WebviewWindowBuilder};
use tokio::process::Command;
use tokio::sync::Mutex;
use tokio::time::{timeout, Duration};

mod commands;
mod secure_store;
mod skills;
// re-export tools functions for remaining inline code
use crate::commands::opencode::{stop_opencode_runtime, OpenCodeRuntime};


// ─── Plugin 系统命令 ───

fn is_workbench_return_url(url: &tauri::Url) -> bool {
    // 仅拦截登录回调域名（jiucaihezi.studio），不拦截 NewAPI 自身（api.jiucaihezi.studio）
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

/// 检测 whisper-cli sidecar 是否为真实二进制（非占位脚本）
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DevListFilesInput {
    root: String,
    relative_path: Option<String>,
    max_entries: Option<usize>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DevSearchProjectPathsInput {
    root: String,
    query: String,
    limit: usize,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DevReadFileInput {
    root: String,
    relative_path: String,
    max_bytes: Option<usize>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DevFileExistsInput {
    root: String,
    relative_path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DevWriteFileInput {
    root: String,
    relative_path: String,
    #[serde(default)]
    content: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DevWriteFileIfRevisionInput {
    root: String,
    relative_path: String,
    content: String,
    expected_revision: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DevWriteFileBytesInput {
    root: String,
    relative_path: String,
    data_base64: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DevSaveProjectFileAsInput {
    root: String,
    relative_path: String,
    destination_path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DevImportProjectFilesInput {
    root: String,
    target_relative_path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DevImportProjectDropInput {
    root: String,
    source_paths: Vec<String>,
    target_relative_path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DevImportProjectFolderInput {
    root: String,
    target_relative_path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DevExportProjectInput {
    root: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DevExportProjectPathsInput {
    root: String,
    relative_paths: Vec<String>,
    destination_directory: String,
    policy: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DevRunCommandInput {
    root: String,
    command: String,
    workdir: Option<String>,
    external_workdir: Option<String>,
    timeout_seconds: Option<u64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DevExternalListFilesInput {
    path: String,
    max_entries: Option<usize>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DevExternalReadFileInput {
    path: String,
    max_bytes: Option<usize>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DevExternalWriteFileInput {
    path: String,
    #[serde(default)]
    content: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DevExternalReplaceInFileInput {
    path: String,
    old_text: String,
    new_text: String,
    replace_all: Option<bool>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SkillMaterialSourceInput {
    source_type: String,
    value: String,
    github_token: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SkillMaterialCompileInput {
    runtime_root: String,
    workspace_path: String,
    name: String,
    source: SkillMaterialSourceInput,
    preset: Option<String>,
    max_pages: Option<u32>,
    timeout_seconds: Option<u64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DevDetectProjectInput {
    root: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DevSearchTextInput {
    root: String,
    relative_path: Option<String>,
    query: String,
    max_results: Option<usize>,
    context_lines: Option<usize>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DevReadManyFilesInput {
    root: String,
    paths: Vec<String>,
    max_bytes_per_file: Option<usize>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DevReplaceInFileInput {
    root: String,
    relative_path: String,
    old_text: String,
    new_text: String,
    replace_all: Option<bool>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DevGetDiffInput {
    root: String,
    relative_path: Option<String>,
    max_bytes: Option<usize>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MediaCacheFileInput {
    filename: String,
    data_base64: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MediaProcessFileInput {
    input_path: String,
    action: String,
    target_format: String,
    output_filename: String,
    start_seconds: Option<f64>,
    end_seconds: Option<f64>,
    crf: Option<u8>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MediaTranscribeFileInput {
    input_path: String,
    output_format: Option<String>,
    language: Option<String>,
    model: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MediaBurnSubtitlesInput {
    input_path: String,
    subtitle_text: String,
    output_filename: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MediaInspectFileInput {
    input_path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MediaSelectFileInput {
    title: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DocumentToMarkdownFileInput {
    filename: String,
    #[allow(dead_code)]
    mime_type: Option<String>,
    data_base64: String,
    conversion_mode: Option<String>,
    output_format: Option<String>,
    timeout_seconds: Option<u64>,
    max_chars: Option<usize>,
    job_id: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DocumentPathToMarkdownInput {
    source_path: String,
    output_dir: Option<String>,
    conversion_mode: Option<String>,
    output_format: Option<String>,
    timeout_seconds: Option<u64>,
    max_chars: Option<usize>,
    job_id: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CancelMarkdownConversionInput {
    job_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DevFileEntry {
    path: String,
    is_dir: bool,
    size: Option<u64>,
    updated_at: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DevReadFileOutput {
    path: String,
    content: String,
    base64: String,
    truncated: bool,
    size: usize,
    revision: DevResourceRevision,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DevResourceRevision {
    value: String,
    size: usize,
    updated_at: Option<u128>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DevWriteFileIfRevisionOutput {
    status: String,
    revision: Option<DevResourceRevision>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DevWriteFileOutput {
    path: String,
    bytes_written: usize,
}

#[derive(Serialize)]
struct DevDeleteFileOutput {
    status: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DevRunCommandOutput {
    command: String,
    exit_code: Option<i32>,
    stdout: String,
    stderr: String,
    duration_ms: u128,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SkillMaterialRawFile {
    path: String,
    content: String,
    mime_type: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SkillMaterialCompileOutput {
    command: String,
    exit_code: Option<i32>,
    stdout: String,
    stderr: String,
    duration_ms: u128,
    raw_files: Vec<SkillMaterialRawFile>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DevProjectDetection {
    project_types: Vec<String>,
    markers: Vec<String>,
    package_manager: Option<String>,
    recommended_commands: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DevTextMatch {
    path: String,
    line_number: usize,
    line: String,
    before: Vec<String>,
    after: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DevReplaceInFileOutput {
    path: String,
    replacements: usize,
    bytes_written: usize,
    diff: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DevGetDiffOutput {
    source: String,
    diff: String,
    truncated: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MediaCacheFileOutput {
    input_path: String,
    filename: String,
    size: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MediaProcessFileOutput {
    output_path: String,
    output_filename: String,
    output_size: u64,
    stdout: String,
    stderr: String,
    duration_ms: u128,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MediaTranscribeFileOutput {
    output_path: String,
    output_filename: String,
    output_size: u64,
    text: String,
    stdout: String,
    stderr: String,
    duration_ms: u128,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MediaInspectFileOutput {
    input_path: String,
    filename: String,
    size: u64,
    format: String,
    kind: String,
    duration_seconds: Option<f64>,
    width: Option<u64>,
    height: Option<u64>,
    fps: Option<f64>,
    audio_codec: Option<String>,
    video_codec: Option<String>,
    has_audio: bool,
    has_video: bool,
    has_subtitles: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DocumentToMarkdownFileOutput {
    status: String,
    source: String,
    filename: String,
    content: String,
    engine: String,
    source_path: String,
    output_path: String,
    truncated: bool,
    message: String,
    error: Option<String>,
}

struct MarkdownConversion {
    content: String,
    engine: String,
    truncated: bool,
    message: String,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum MarkdownConversionMode {
    Auto,
    Fast,
    Ocr,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct FormatConverterProgress {
    job_id: Option<String>,
    source_path: String,
    completed_pages: usize,
    total_pages: usize,
    progress: u8,
    message: String,
}

#[derive(Default)]
struct MediaCaptureJobs {
    cancelled: Mutex<HashSet<String>>,
    pids: Mutex<HashMap<String, u32>>,
    allowed_outputs: Mutex<HashSet<PathBuf>>,
    allowed_inputs: Mutex<HashSet<PathBuf>>,
}

impl MediaCaptureJobs {
    async fn is_allowed_input(&self, path: &Path) -> bool {
        let Ok(canonical) = std::fs::canonicalize(path) else { return false; };
        self.allowed_inputs.lock().await.contains(&canonical)
    }
    async fn allow_input(&self, path: &Path) -> Result<PathBuf, String> {
        let canonical = std::fs::canonicalize(path).map_err(|_| "文件不可访问，请重新选择。")?;
        if !canonical.is_file() { return Err("请选择有效的音频或视频文件。".into()); }
        self.allowed_inputs.lock().await.insert(canonical.clone());
        Ok(canonical)
    }
    async fn allow_output(&self, path: &Path) -> Result<(), String> {
        let canonical = std::fs::canonicalize(path).map_err(|e| format!("输出文件不可访问: {e}"))?;
        self.allowed_outputs.lock().await.insert(canonical);
        Ok(())
    }
}

fn sanitize_media_process_error(detail: &str, fallback: &str) -> String {
    let v = detail.trim();
    if v.is_empty() { return fallback.into(); }
    let first_line = v.lines().next().unwrap_or(fallback);
    let lower = first_line.to_ascii_lowercase();
    let exposes_internal_tool = ["ffmpeg", "whisper", "rapidocr", "yt-dlp"]
        .iter()
        .any(|name| lower.contains(name));
    let exposes_private_path = first_line.contains("/Users/")
        || first_line.contains("/home/")
        || first_line.contains("\\Users\\");
    if exposes_internal_tool || exposes_private_path {
        return fallback.into();
    }
    first_line.chars().take(200).collect()
}

#[derive(Default)]
struct ConversionJobs {
    cancelled: Mutex<HashSet<String>>,
    pids: Mutex<HashMap<String, u32>>,
}

impl ConversionJobs {
    async fn is_cancelled(&self, job_id: Option<&str>) -> bool {
        let Some(job_id) = job_id else {
            return false;
        };
        self.cancelled.lock().await.contains(job_id)
    }

    async fn register_pid(&self, job_id: Option<&str>, pid: Option<u32>) {
        if let (Some(job_id), Some(pid)) = (job_id, pid) {
            self.pids.lock().await.insert(job_id.to_string(), pid);
        }
    }

    async fn clear_pid(&self, job_id: Option<&str>) {
        if let Some(job_id) = job_id {
            self.pids.lock().await.remove(job_id);
        }
    }

    async fn finish_job(&self, job_id: Option<&str>) {
        if let Some(job_id) = job_id {
            self.pids.lock().await.remove(job_id);
            self.cancelled.lock().await.remove(job_id);
        }
    }

    async fn cancel_job(&self, job_id: &str) {
        self.cancelled.lock().await.insert(job_id.to_string());
        let pid = self.pids.lock().await.get(job_id).copied();
        if let Some(pid) = pid {
            let _ = StdCommand::new("kill").arg("-TERM").arg(pid.to_string()).output();
        }
    }
}

fn split_command(command: &str) -> Result<(String, Vec<String>), String> {
    let value = command.trim();
    if value.is_empty() {
        return Err("缺少要执行的命令".into());
    }
    #[cfg(target_os = "windows")]
    return Ok(("cmd".into(), vec!["/C".into(), value.into()]));
    #[cfg(not(target_os = "windows"))]
    return Ok(("sh".into(), vec!["-lc".into(), value.into()]));
}

mod tests {
    use super::*;
    use crate::commands::http::{
        should_direct_unified_api_to_newapi, HttpRequest, Utf8StreamDecoder,
    };
    use crate::commands::media::{
        convert_markdown_for_output, find_transcript_output, is_meaningful_markdown,
        is_successful_markdown_content, validate_selected_media_path,
    };
    use crate::commands::opencode::prepare_opencode_runtime_dirs;
    use crate::commands::skill_material::{
        build_skill_material_command, collect_skill_material_raw_files,
        latest_skill_seekers_output_dir,
    };
    use crate::commands::tools::{
        opencode_platform_package_dir, opencode_resource_names,
        resolve_opencode_binary_from_inputs,
    };
    use std::time::SystemTime;

    fn temp_test_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "jc_skill_material_{}_{}",
            name,
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("create temp test dir");
        dir
    }

    fn compile_input(runtime_root: &Path, source_type: &str, value: &str) -> SkillMaterialCompileInput {
        SkillMaterialCompileInput {
            runtime_root: runtime_root.to_string_lossy().to_string(),
            workspace_path: temp_test_dir("workspace").to_string_lossy().to_string(),
            name: "Repo Skill".into(),
            source: SkillMaterialSourceInput {
                source_type: source_type.into(),
                value: value.into(),
                github_token: None,
            },
            preset: Some("quick".into()),
            max_pages: Some(12),
            timeout_seconds: Some(1),
        }
    }

    #[test]
    fn selected_media_path_validation_accepts_real_files_only() {
        let root = temp_test_dir("media_workbench_path");
        let file = root.join("demo.mp4");
        std::fs::write(&file, b"media").expect("write media placeholder");

        assert!(validate_selected_media_path(&file.to_string_lossy()).is_ok());
        assert!(validate_selected_media_path("demo.mp4").is_err());
        assert!(validate_selected_media_path("").is_err());
        assert!(validate_selected_media_path(&format!("{}/../demo.mp4", root.to_string_lossy())).is_err());
        assert!(validate_selected_media_path(&root.to_string_lossy()).is_err());
    }

    #[test]
    fn transcript_output_selection_requires_matching_stem_and_recent_mtime() {
        let output_dir = temp_test_dir("media_transcript_output");
        let wrong = output_dir.join("other.txt");
        std::fs::write(&wrong, b"old").expect("write wrong transcript");

        assert!(find_transcript_output(&output_dir, "demo", "txt", SystemTime::now()).is_none());

        let expected = output_dir.join("demo.txt");
        std::fs::write(&expected, b"new").expect("write transcript");

        let selected = find_transcript_output(&output_dir, "demo", "txt", SystemTime::now())
            .expect("find transcript");
        assert_eq!(selected, expected);
    }

    #[test]
    fn media_process_error_sanitizer_hides_internal_tool_details() {
        let raw = "ffmpeg failed opening /Users/by3/private/demo.mp4";
        let sanitized = sanitize_media_process_error(raw, "请检查文件后重试。");

        assert_eq!(sanitized, "请检查文件后重试。");
        assert!(!sanitized.contains("ffmpeg"));
        assert!(!sanitized.contains("/Users/"));
    }

    #[test]
    fn dev_command_accepts_full_shell_after_user_approval() {
        assert!(split_command("ffmpeg -version").is_ok());
        assert!(split_command("ffprobe -version").is_ok());
        assert!(split_command("mkdir -p /tmp/reverse_video_frames").is_ok());
        assert!(split_command("ffmpeg -i clip.mp4 -f null - | grep showinfo").is_ok());
    }

    #[test]
    fn skill_material_command_keeps_github_token_out_of_argv() {
        let runtime_root = temp_test_dir("runtime");
        let mut input = compile_input(&runtime_root, "github_repo", "owner/project");
        input.source.github_token = Some("ghp_secret_token".into());

        let spec = build_skill_material_command(&input).expect("build command");

        assert_eq!(spec.program, "uv");
        assert_eq!(spec.env.get("GITHUB_TOKEN").map(String::as_str), Some("ghp_secret_token"));
        assert!(!spec.args.iter().any(|arg| arg.contains("ghp_secret_token")));
        assert!(!spec.display_command.contains("ghp_secret_token"));
        assert_eq!(spec.args, vec![
            "run",
            "skill-seekers",
            "create",
            "owner/project",
            "--name",
            "Repo Skill",
            "--preset",
            "quick",
            "--output",
            input.workspace_path.as_str(),
            "--enhance-level",
            "0",
            "--quiet",
            "--non-interactive",
        ]);
    }

    #[test]
    fn skill_material_command_writes_to_job_workspace() {
        let runtime_root = temp_test_dir("runtime_workspace");
        let input = compile_input(&runtime_root, "local_codebase", "/Users/by3/Documents/project");

        let spec = build_skill_material_command(&input).expect("build command");

        let output_index = spec.args.iter().position(|arg| arg == "--output").expect("output flag");
        assert_eq!(spec.args.get(output_index + 1).map(String::as_str), Some(input.workspace_path.as_str()));
    }

    #[test]
    fn skill_material_source_validation_rejects_unsafe_inputs() {
        let runtime_root = temp_test_dir("runtime_validation");
        assert!(build_skill_material_command(&compile_input(&runtime_root, "documentation_url", "file:///tmp/a")).is_err());
        assert!(build_skill_material_command(&compile_input(&runtime_root, "documentation_url", "http://localhost:3000/docs")).is_err());
        assert!(build_skill_material_command(&compile_input(&runtime_root, "documentation_url", "https://user:pass@example.com/docs")).is_err());
        assert!(build_skill_material_command(&compile_input(&runtime_root, "documentation_url", "http://169.254.169.254/latest/meta-data")).is_err());
        assert!(build_skill_material_command(&compile_input(&runtime_root, "local_codebase", "../project")).is_err());
        assert!(build_skill_material_command(&compile_input(&runtime_root, "github_repo", "https://example.com/repo")).is_err());
        assert!(build_skill_material_command(&compile_input(&runtime_root, "openapi", "https://example.com/openapi.json")).is_err());

        #[cfg(unix)]
        {
            let secret_target = temp_test_dir("source_secret_target");
            let link = runtime_root.join("link_to_secret");
            std::os::unix::fs::symlink(&secret_target, &link).expect("create source symlink");
            assert!(build_skill_material_command(&compile_input(&runtime_root, "local_codebase", &link.to_string_lossy())).is_err());
        }
    }

    #[test]
    fn collect_skill_material_raw_files_rejects_symlinks_and_keeps_relative_paths() {
        let root = temp_test_dir("raw_files");
        std::fs::create_dir_all(root.join("references")).expect("mkdir references");
        std::fs::write(root.join("SKILL.md"), "# Skill").expect("write skill");
        std::fs::write(root.join("references/source.md"), "# Source").expect("write reference");

        let files = collect_skill_material_raw_files(&root, 10, 1024).expect("collect files");
        let paths: Vec<String> = files.into_iter().map(|file| file.path).collect();
        assert_eq!(paths, vec!["SKILL.md", "references/source.md"]);

        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(root.join("SKILL.md"), root.join("references/link.md")).expect("symlink");
            assert!(collect_skill_material_raw_files(&root, 10, 1024).is_err());
        }
    }

    #[test]
    fn skill_material_latest_skill_seekers_output_dir_finds_output_with_skill_md() {
        let runtime_root = temp_test_dir("runtime_output");
        let old_dir = runtime_root.join("output/old");
        let new_dir = runtime_root.join("output/new");
        std::fs::create_dir_all(&old_dir).expect("mkdir old");
        std::fs::create_dir_all(&new_dir).expect("mkdir new");
        std::fs::write(old_dir.join("SKILL.md"), "# Old").expect("write old");
        std::thread::sleep(std::time::Duration::from_millis(2));
        std::fs::write(new_dir.join("SKILL.md"), "# New").expect("write new");

        let found = latest_skill_seekers_output_dir(&runtime_root, std::time::SystemTime::UNIX_EPOCH).expect("find latest output");
        assert_eq!(found.file_name().and_then(|name| name.to_str()), Some("new"));

        let files = collect_skill_material_raw_files(&found, 10, 1024).expect("collect latest");
        assert_eq!(files[0].path, "SKILL.md");
        assert_eq!(files[0].content, "# New");
    }

    #[test]
    fn skill_material_latest_skill_seekers_output_dir_ignores_stale_outputs() {
        let runtime_root = temp_test_dir("runtime_stale_output");
        let output = runtime_root.join("output/old-output");
        std::fs::create_dir_all(&output).expect("mkdir output");
        std::fs::write(output.join("SKILL.md"), "# Old Skill").expect("write skill");

        let future_start = std::time::SystemTime::now() + Duration::from_secs(60);
        assert!(latest_skill_seekers_output_dir(&runtime_root, future_start).is_none());
    }

    #[test]
    fn utf8_stream_decoder_preserves_multibyte_characters_split_across_chunks() {
        let sample = "开头 中文 emoji 😄 结尾";
        let bytes = sample.as_bytes();
        let split_at = bytes
            .windows(3)
            .position(|window| window == "中".as_bytes())
            .expect("sample contains chinese character")
            + 1;

        let mut decoder = Utf8StreamDecoder::default();
        let mut output = String::new();
        output.push_str(&decoder.push(&bytes[..split_at]));
        output.push_str(&decoder.push(&bytes[split_at..]));
        output.push_str(&decoder.finish());

        assert_eq!(output, sample);
        assert!(!output.contains('\u{fffd}'));
    }

    #[test]
    fn normal_markdown_is_valid_cache_content() {
        let content = r#"# 第一章 故事结构

这一章讲三幕式结构、人物目标和反击战的节奏设计。
"#;

        assert!(is_successful_markdown_content(content));
    }

    #[test]
    fn converts_markdown_table_to_csv() {
        let markdown = "| 姓名 | 年龄 |\n| --- | --- |\n| 张三 | 18 |\n| 李四 | 20 |";
        let csv = convert_markdown_for_output("csv", markdown).expect("csv output");
        assert_eq!(csv, "姓名,年龄\n张三,18\n李四,20\n");
    }

    #[test]
    fn validates_json_and_srt_outputs() {
        let json = convert_markdown_for_output("json", "```json\n{\"a\":1}\n```").expect("json output");
        assert_eq!(json, "{\n  \"a\": 1\n}\n");

        let srt = "1\n00:00:00,000 --> 00:00:01,000\n你好\n";
        assert_eq!(convert_markdown_for_output("srt", srt).expect("srt output"), srt);
        assert!(convert_markdown_for_output("srt", "# 普通正文").is_err());
    }

    #[test]
    fn opencode_binary_resolution_prefers_explicit_jc_path() {
        let root = temp_test_dir("opencode_explicit");
        let explicit = root.join("custom-opencode");
        std::fs::write(&explicit, b"#!/bin/sh\n").expect("write fake opencode");

        let resolved = resolve_opencode_binary_from_inputs(
            &[],
            None,
            Some(explicit.as_os_str()),
            None,
            None,
        )
        .expect("resolve explicit opencode");

        assert_eq!(resolved, explicit);
    }

    #[test]
    fn opencode_binary_resolution_uses_path_before_dev_checkout() {
        let home = temp_test_dir("opencode_home");
        let path_dir = temp_test_dir("opencode_path");
        let path_binary = path_dir.join("opencode");
        std::fs::write(&path_binary, b"#!/bin/sh\n").expect("write path opencode");

        let dev_binary = home
            .join("Documents/1OKAPP/my-opencode/packages/opencode/dist")
            .join(opencode_platform_package_dir().expect("platform package"))
            .join("bin/opencode");
        std::fs::create_dir_all(dev_binary.parent().expect("dev parent")).expect("mkdir dev parent");
        std::fs::write(&dev_binary, b"#!/bin/sh\n").expect("write dev opencode");

        let resolved = resolve_opencode_binary_from_inputs(
            &[],
            Some(home.as_path()),
            None,
            None,
            Some(path_dir.as_os_str()),
        )
        .expect("resolve path opencode");

        assert_eq!(resolved, path_binary);
    }

    #[test]
    fn opencode_binary_resolution_can_use_local_dev_checkout() {
        let home = temp_test_dir("opencode_dev_home");
        let dev_binary = home
            .join("Documents/1OKAPP/my-opencode/packages/opencode/dist")
            .join(opencode_platform_package_dir().expect("platform package"))
            .join("bin/opencode");
        std::fs::create_dir_all(dev_binary.parent().expect("dev parent")).expect("mkdir dev parent");
        std::fs::write(&dev_binary, b"#!/bin/sh\n").expect("write dev opencode");

        let resolved = resolve_opencode_binary_from_inputs(
            &[],
            Some(home.as_path()),
            None,
            None,
            None,
        )
        .expect("resolve dev checkout opencode");

        assert_eq!(resolved, dev_binary);
    }

    #[test]
    fn opencode_binary_resolution_uses_bundled_resource_before_path() {
        let resource_dir = temp_test_dir("opencode_resource");
        let path_dir = temp_test_dir("opencode_path_with_resource");
        let bundled = resource_dir.join("binaries").join(opencode_resource_names()[0].clone());
        let path_binary = path_dir.join("opencode");
        std::fs::create_dir_all(bundled.parent().expect("bundled parent")).expect("mkdir bundled parent");
        std::fs::write(&bundled, b"#!/bin/sh\n").expect("write bundled opencode");
        std::fs::write(&path_binary, b"#!/bin/sh\n").expect("write path opencode");

        let resolved = resolve_opencode_binary_from_inputs(
            &[resource_dir.join("binaries")],
            None,
            None,
            None,
            Some(path_dir.as_os_str()),
        )
        .expect("resolve bundled opencode");

        assert_eq!(resolved, bundled);
    }

    #[test]
    fn opencode_binary_resolution_reports_missing_runtime() {
        let err = resolve_opencode_binary_from_inputs(&[], None, None, None, None)
            .expect_err("missing opencode should be explicit");

        assert!(err.contains("OpenCode runtime 未安装"));
        assert!(err.contains("JC_OPENCODE_BIN"));
    }

    #[test]
    fn opencode_runtime_dirs_are_created_under_runtime_root() {
        let root = temp_test_dir("opencode_runtime_dirs");

        let (data, state, config, workspace) = prepare_opencode_runtime_dirs(&root)
            .expect("prepare runtime dirs");

        assert_eq!(data, root.join("data"));
        assert_eq!(state, root.join("state"));
        assert_eq!(config, root.join("config"));
        assert_eq!(workspace, root.join("workspace/default"));
        assert!(data.is_dir());
        assert!(state.is_dir());
        assert!(config.is_dir());
        assert!(workspace.is_dir());
    }

    #[test]
    fn manual_key_unified_api_requests_direct_to_newapi_source() {
        let mut headers = HashMap::new();
        headers.insert("Authorization".into(), "Bearer sk-manual-key".into());
        let request = HttpRequest {
            url: "https://api.jiucaihezi.studio/v1/chat/completions".into(),
            method: Some("POST".into()),
            headers: Some(headers),
            body: None,
            timeout_secs: None,
        };

        assert!(should_direct_unified_api_to_newapi(&request));
    }

    #[test]
    fn gateway_session_unified_api_requests_stay_on_cloudflare_worker() {
        let mut headers = HashMap::new();
        headers.insert("Authorization".into(), "Bearer sess_123".into());
        headers.insert("X-JC-Session".into(), "sess_123".into());
        let request = HttpRequest {
            url: "https://api.jiucaihezi.studio/v1/chat/completions".into(),
            method: Some("POST".into()),
            headers: Some(headers),
            body: None,
            timeout_secs: None,
        };

        assert!(!should_direct_unified_api_to_newapi(&request));
    }

    #[test]
    fn auth_login_always_stays_on_cloudflare_worker() {
        let mut headers = HashMap::new();
        headers.insert("Content-Type".into(), "application/json".into());
        let request = HttpRequest {
            url: "https://api.jiucaihezi.studio/auth/login".into(),
            method: Some("POST".into()),
            headers: Some(headers),
            body: None,
            timeout_secs: None,
        };

        assert!(!should_direct_unified_api_to_newapi(&request));
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // ─── Windows WebView2 检测 ───
    // Tauri v2 在 Windows 上依赖系统 WebView2 Runtime（不像 Electron 自带 Chromium）。
    // 若未安装，Tauri 自身会弹错误对话框引导安装；此处为补充日志。
    #[cfg(target_os = "windows")]
    {
        let pf = std::env::var("ProgramFiles").unwrap_or_default();
        let pfx86 = std::env::var("ProgramFiles(x86)").unwrap_or_default();
        let mut found = false;
        let mut checked_paths: Vec<String> = Vec::new();
        for base in [&pf, &pfx86] {
            let candidate = std::path::PathBuf::from(base)
                .join("Microsoft/EdgeWebView/Application/msedgewebview2.exe");
            checked_paths.push(candidate.display().to_string());
            if candidate.exists() {
                found = true;
                break;
            }
        }
        if found {
            eprintln!("[JC] ✅ WebView2 Runtime 已安装");
        } else {
            eprintln!("[JC] ❌ WebView2 Runtime 未安装！（已检查: {}）", checked_paths.join(", "));
            eprintln!("[JC] 请从以下地址下载安装：");
            eprintln!("[JC] https://go.microsoft.com/fwlink/p/?LinkId=2124703");
            eprintln!("[JC] 安装后重新运行韭菜盒子即可。");
        }
    }

    let app = tauri::Builder::default()
        .manage(ConversionJobs::default())
        .manage(OpenCodeRuntime::default())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .setup(|app| {
            let skills_db_dir = skills::path_utils::app_data_dir();
            std::fs::create_dir_all(&skills_db_dir)
                .expect("Failed to create ~/.skillsmanage directory");
            let skills_db_path =
                skills::path_utils::path_to_string(&skills_db_dir.join("db.sqlite"));

            // 解析内置 Skill 源目录（同步，不阻塞窗口创建）
            // dev: 从 target/debug/ 上 3 层到项目根 → public/skills/
            // prod: resource_dir()/skills/
            let resource_dir = app.path().resource_dir().ok();
            let preset_skills_src = resource_dir.as_ref().and_then(|rd| {
                let prod_path = rd.join("skills");
                if prod_path.exists() { return Some(prod_path); }
                let dev_path = rd.join("../../..").join("public").join("skills");
                if dev_path.exists() { return Some(dev_path); }
                eprintln!("[JC] seed: neither prod ({}) nor dev ({}) exists", prod_path.display(), dev_path.display());
                None
            });

            // 创建目录（同步），确保路径存在
            // skills DB 连接池和表迁移移到后台——不阻塞窗口创建
            let app_handle = app.handle().clone();
            let db_path = skills_db_path.clone();
            let skills_src = preset_skills_src.clone();
            tauri::async_runtime::spawn(async move {
                match skills::db::create_pool(&db_path).await {
                    Ok(pool) => {
                        if let Err(e) = skills::db::init_database(&pool).await {
                            eprintln!("[JC] skills DB init failed: {e}");
                        }
                        // 内置 Skill 保持在应用资源中；仅清理旧版本创建的带标记副本。
                        if let Some(ref src) = skills_src {
                            if let Err(e) = skills::db::remove_seeded_preset_skills(src) {
                                eprintln!("[JC] cleanup seeded skills failed: {e}");
                            }
                        }
                        app_handle.manage(skills::SkillsAppState {
                            db: pool,
                            preset_skills_src: skills_src,
                        });
                    }
                    Err(e) => {
                        eprintln!("[JC] skills DB pool failed: {e}");
                    }
                }
            });

            // 确保应用数据目录存在
            let app_data = app.path().app_data_dir().expect("failed to get app data dir");
            std::fs::create_dir_all(&app_data).ok();
            // 创建 vault 子目录
            std::fs::create_dir_all(app_data.join("vault")).ok();

            // ★ 手动建窗以挂载 on_navigation 拦截 NewAPI 登录回调
            let window_config = app.config().app.windows.first()
                .ok_or("missing main window config")?;
            let app_handle_nav = app.handle().clone();
            let app_handle_new = app.handle().clone();

            let window = WebviewWindowBuilder::from_config(app.handle(), window_config)?
                .on_navigation(move |url| {
                    if is_workbench_return_url(url) {
                        if let Some(main) = app_handle_nav.get_webview_window("main") {
                            let _ = main.navigate(workbench_url_from_return(url));
                            let _ = main.set_focus();
                        }
                        false  // 阻止真实导航
                    } else {
                        true
                    }
                })
                .on_new_window(move |url, _features| {
                    if is_workbench_return_url(&url) {
                        if let Some(main) = app_handle_new.get_webview_window("main") {
                            let _ = main.navigate(workbench_url_from_return(&url));
                            let _ = main.set_focus();
                        }
                    }
                    NewWindowResponse::Deny
                })
                .initialization_script(
                    r#"
(() => {
  const workbenchHosts = new Set([
    'jiucaihezi.studio',
    'www.jiucaihezi.studio',
  ]);
  function isWorkbenchReturn(value) {
    try {
      const url = new URL(String(value || ''), window.location.href);
      return workbenchHosts.has(url.hostname);
    } catch (_) { return false; }
  }
  function goWorkbench(value) {
    let target = new URL('tauri://localhost/');
    window.location.href = target.href;
  }
  const nativeOpen = window.open;
  window.open = function(url, target, features) {
    if (isWorkbenchReturn(url)) { goWorkbench(url); return window; }
    return nativeOpen ? nativeOpen.call(window, url, target, features) : null;
  };
  document.addEventListener('click', (event) => {
    const anchor = event.target && event.target.closest ? event.target.closest('a[href]') : null;
    if (anchor && isWorkbenchReturn(anchor.href)) {
      event.preventDefault(); goWorkbench(anchor.href);
    }
  }, true);

  // ═══ NewAPI 页面增强 ═══
  const host = window.location.hostname;
  if (host === 'api.jiucaihezi.studio' || host === 'jiucaihezi.studio' || host === 'www.jiucaihezi.studio') {
    var btnAdded = false;
    function addFloatBtn() {
      if (btnAdded || !document.body) return;
      btnAdded = true;
      var b = document.createElement('button');
      b.textContent = '\u2190 \u8fd4\u56de\u5de5\u4f5c\u53f0';
      Object.assign(b.style, {
        position:'fixed',bottom:'20px',left:'20px',zIndex:'99999',
        padding:'10px 18px',border:'none',borderRadius:'10px',
        background:'#6B8E23',color:'#fff',fontSize:'14px',fontWeight:'700',
        cursor:'pointer',fontFamily:'inherit',
        boxShadow:'0 4px 16px rgba(107,142,35,.35)',
        transition:'transform .15s',
      });
      b.onmouseenter=function(){b.style.transform='scale(1.05)'};
      b.onmouseleave=function(){b.style.transform='scale(1)'};
      b.onclick=function(){goWorkbench('https://jiucaihezi.studio')};
      document.body.appendChild(b);
    }
    addFloatBtn();
    setTimeout(addFloatBtn, 800);
    setTimeout(addFloatBtn, 2500);
    setTimeout(addFloatBtn, 6000);
    new MutationObserver(function() {
      addFloatBtn();
    }).observe(document.documentElement || document.body, { childList: true, subtree: true });
  }
})();
"#,
                )
                .enable_clipboard_access()
                .build()?;

            #[cfg(unix)]
            {
                let app_signal = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    use tokio::signal::unix::{signal, SignalKind};
                    let Ok(mut interrupt) = signal(SignalKind::interrupt()) else { return };
                    let Ok(mut terminate) = signal(SignalKind::terminate()) else { return };
                    tokio::select! {
                        _ = interrupt.recv() => {}
                        _ = terminate.recv() => {}
                    }
                    let runtime = app_signal.state::<OpenCodeRuntime>();
                    stop_opencode_runtime(&runtime).await;
                    app_signal.exit(0);
                });
            }

            #[cfg(windows)]
            {
                let app_signal = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    if tokio::signal::ctrl_c().await.is_err() { return; }
                    let runtime = app_signal.state::<OpenCodeRuntime>();
                    stop_opencode_runtime(&runtime).await;
                    app_signal.exit(0);
                });
            }

            // ponytail: 照抄 OpenCode desktop/main/menu.ts — macOS 应用菜单
            #[cfg(target_os = "macos")]
            {
                use tauri::menu::{MenuBuilder, PredefinedMenuItem, SubmenuBuilder};
                // ponytail: Edit 子菜单 — PredefinedMenuItem 必须放在子菜单里才能正确注册键盘加速器
                let edit_menu = SubmenuBuilder::new(app, "Edit")
                    .item(&PredefinedMenuItem::undo(app, None)?)
                    .item(&PredefinedMenuItem::redo(app, None)?)
                    .separator()
                    .item(&PredefinedMenuItem::cut(app, None)?)
                    .item(&PredefinedMenuItem::copy(app, None)?)
                    .item(&PredefinedMenuItem::paste(app, None)?)
                    .separator()
                    .item(&PredefinedMenuItem::select_all(app, None)?)
                    .build()?;
                let menu = MenuBuilder::new(app)
                    .item(&PredefinedMenuItem::about(app, None, None)?)
                    .separator()
                    .item(&PredefinedMenuItem::services(app, None)?)
                    .separator()
                    .item(&PredefinedMenuItem::hide(app, None)?)
                    .item(&PredefinedMenuItem::hide_others(app, None)?)
                    .item(&PredefinedMenuItem::show_all(app, None)?)
                    .separator()
                    .item(&PredefinedMenuItem::quit(app, None)?)
                    .separator()
                    .item(&edit_menu)
                    .separator()
                    .item(&PredefinedMenuItem::minimize(app, None)?)
                    .item(&PredefinedMenuItem::maximize(app, None)?)
                    .item(&PredefinedMenuItem::fullscreen(app, None)?)
                    .build()?;
                app.set_menu(menu)?;
            }

            // ponytail: 照抄 OpenCode desktop/main/windows.ts — 窗口状态持久化
            {
                use std::sync::atomic::{AtomicBool, Ordering};
                let state_path = app_data.join("window-state.json");
                // 恢复窗口位置和大小
                if let Ok(json) = std::fs::read_to_string(&state_path) {
                    if let Ok(state) = serde_json::from_str::<serde_json::Value>(&json) {
                        if let (Some(x), Some(y)) = (state["x"].as_i64(), state["y"].as_i64()) {
                            let _ = window.set_position(tauri::Position::Physical(tauri::PhysicalPosition::new(x as i32, y as i32)));
                        }
                        if let (Some(w), Some(h)) = (state["width"].as_u64(), state["height"].as_u64()) {
                            let _ = window.set_size(tauri::Size::Physical(tauri::PhysicalSize::new(w as u32, h as u32)));
                        }
                    }
                }
                // 保存窗口状态（AtomicBool 节流：同一时间最多一个写操作）
                let saving = std::sync::Arc::new(AtomicBool::new(false));
                let w = window.clone();
                let state_path_save = state_path.clone();
                window.on_window_event(move |event| {
                    if !matches!(event, tauri::WindowEvent::Resized(_) | tauri::WindowEvent::Moved(_)) { return; }
                    if saving.compare_exchange(false, true, Ordering::AcqRel, Ordering::Relaxed).is_err() { return; }
                    let saving = saving.clone();
                    let state_path = state_path_save.clone();
                    if let (Ok(pos), Ok(size)) = (w.outer_position(), w.inner_size()) {
                        let state = serde_json::json!({
                            "x": pos.x, "y": pos.y,
                            "width": size.width, "height": size.height,
                        });
                        std::thread::spawn(move || {
                            let _ = std::fs::write(&state_path, state.to_string());
                            saving.store(false, Ordering::Release);
                        });
                    } else {
                        saving.store(false, Ordering::Release);
                    }
                });
            }

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
            secure_store::get_cli_api_key,
            secure_store::set_api_key,
            secure_store::clear_api_key,
            secure_store::get_gateway_session_token,
            secure_store::set_gateway_session_token,
            secure_store::clear_gateway_session_token,
            secure_store::get_mcp_oauth_credential,
            secure_store::set_mcp_oauth_credential,
            secure_store::clear_mcp_oauth_credential,
            secure_store::get_mcp_server_secret,
            secure_store::set_mcp_server_secret,
            secure_store::clear_mcp_server_secret,
            commands::mcp::mcp_spawn_stdio,
            commands::mcp::mcp_write_stdin,
            commands::mcp::mcp_kill_stdio,
            commands::opencode::opencode_mcp_status,
            commands::opencode::opencode_ensure_server,
            commands::opencode::opencode_stop,
            commands::opencode::opencode_relaunch,
            commands::opencode::opencode_export_debug_logs,
            commands::greet::save_generated_file,
            commands::dev::dev_detect_project,
            commands::dev::dev_list_files,
            commands::dev::dev_list_directory,
            commands::dev::dev_search_project_paths,
            commands::dev::dev_watch_project,
            commands::dev::dev_stop_project_watch,
            commands::dev::dev_list_file_descendants,
            commands::dev::dev_list_external_files,
            commands::dev::dev_search_text,
            commands::dev::dev_file_exists,
            commands::dev::dev_read_file,
            commands::dev::dev_read_external_file,
            commands::dev::dev_read_many_files,
            commands::dev::dev_write_file,
            commands::dev::dev_create_file_if_missing,
            commands::dev::dev_write_file_if_revision,
            commands::dev::dev_append_file,
            commands::dev::dev_write_external_file,
            commands::dev::dev_write_file_bytes,
            commands::dev::dev_save_project_file_as,
            commands::dev::dev_import_project_files,
            commands::dev::dev_import_project_drop,
            commands::dev::dev_import_project_folder,
            commands::dev::dev_export_project,
            commands::dev::dev_export_project_paths,
            commands::dev::dev_rename_file,
            commands::dev::dev_replace_file,
            commands::dev::dev_delete_file,
            commands::dev::dev_batch_project_operation,
            commands::dev::dev_create_dir,
            commands::dev::dev_reveal_in_finder,
            commands::dev::dev_replace_in_file,
            commands::dev::dev_replace_in_external_file,
            commands::dev::dev_get_diff,
            commands::dev::dev_run_command,
            commands::dev::dev_generate_video_thumbnail,
            commands::dev::pick_project_folder,
            commands::dev::open_file_picker,
            commands::dev::save_file_picker,
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
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        if matches!(event, tauri::RunEvent::Exit) {
            let runtime = app_handle.state::<OpenCodeRuntime>();
            tauri::async_runtime::block_on(stop_opencode_runtime(&runtime));
        }
    });
}

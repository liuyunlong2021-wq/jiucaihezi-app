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
struct DevWriteFileBytesInput {
    root: String,
    relative_path: String,
    data_base64: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScaffoldVaultInput {
    vault_root: String,
    folders: Vec<String>,
    files: Vec<(String, String)>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DevRunCommandInput {
    root: String,
    command: String,
    workdir: Option<String>,
    timeout_seconds: Option<u64>,
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
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DevReadFileOutput {
    path: String,
    content: String,
    base64: String,
    truncated: bool,
    size: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DevWriteFileOutput {
    path: String,
    bytes_written: usize,
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
    v.lines().next().unwrap_or(fallback).chars().take(200).collect()
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

fn has_unsafe_shell_syntax(command: &str) -> bool {
    command.contains("&&")
        || command.contains("||")
        || command.contains(';')
        || command.contains('|')
        || command.contains('>')
        || command.contains('<')
        || command.contains('`')
        || command.contains('$')
        || command.contains('\n')
        || command.contains('\r')
}

fn split_command(command: &str) -> Result<(String, Vec<String>), String> {
    let value = command.trim();
    if value.is_empty() {
        return Err("缺少要执行的命令".into());
    }
    if has_unsafe_shell_syntax(value) {
        return Err("命令包含不支持的 shell 语法，请改为单条命令".into());
    }

    let mut parts: Vec<String> = Vec::new();
    let mut current = String::new();
    let mut quote: Option<char> = None;
    for ch in value.chars() {
        if (ch == '"' || ch == '\'') && quote.is_none() {
            quote = Some(ch);
            continue;
        }
        if Some(ch) == quote {
            quote = None;
            continue;
        }
        if ch.is_whitespace() && quote.is_none() {
            if !current.is_empty() {
                parts.push(current.clone());
                current.clear();
            }
            continue;
        }
        current.push(ch);
    }
    if quote.is_some() {
        return Err("命令引号未闭合".into());
    }
    if !current.is_empty() {
        parts.push(current);
    }
    let program = parts.first().ok_or_else(|| "缺少要执行的命令".to_string())?.clone();
    let allowed = [
        "pnpm", "npm", "yarn", "bun", "cargo", "node", "npx", "deno", "tsc", "vite", "tauri",
        "pytest", "ruff",
    ];
    if !allowed.contains(&program.as_str()) {
        return Err(format!("不允许执行此命令入口: {}", program));
    }
    Ok((program, parts.into_iter().skip(1).collect()))
}

mod tests {
    use super::*;

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
    fn media_url_validation_accepts_only_http_links() {
        assert!(validate_media_url("https://www.xinpianchang.com/a-demo").is_ok());
        assert!(validate_media_url("http://example.com/video").is_ok());
        assert!(validate_media_url("file:///tmp/video.mp4").is_err());
        assert!(validate_media_url("javascript:alert(1)").is_err());
        assert!(validate_media_url("not a url").is_err());
    }

    #[test]
    fn media_url_validation_normalizes_unicode_urls_before_capture() {
        let normalized = validate_media_url("https://example.com/watch/中文路径?标题=测试").expect("valid unicode url");

        assert!(!normalized.contains("中文路径"));
        assert!(!normalized.contains("测试"));
        assert!(normalized.contains("%E4%B8%AD%E6%96%87%E8%B7%AF%E5%BE%84"));
        assert!(normalized.contains("%E6%B5%8B%E8%AF%95"));
    }

    #[test]
    fn media_url_validation_rewrites_douyin_modal_links_to_video_links() {
        let normalized = validate_media_url("https://www.douyin.com/jingxuan/beauty/search/%E8%8B%8D%E8%80%81%E5%B8%88?aid=204f4248-6c6f-46b4-b48d-b73dee52f33b&modal_id=7602293488697232881&type=general")
            .expect("valid douyin modal url");

        assert_eq!(normalized, "https://www.douyin.com/video/7602293488697232881");
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
    fn media_url_download_args_are_structured_and_whitelisted() {
            let input = MediaUrlDownloadInput {
                job_id: "job".into(),
                url: "https://example.com/watch".into(),
                title: Some("Demo".into()),
                kind: "video".into(),
                video_quality: Some("compact".into()),
                audio_format: None,
                subtitle_language: None,
                output_dir: None,
                use_browser_session: None,
                extra_args: None,
            };
        let args = build_media_url_download_args(&input, Path::new("/tmp/jc-media-job"), None).expect("build args");

        assert!(args.contains(&"--no-playlist".to_string()));
        assert!(args.contains(&"-f".to_string()));
        assert!(args.contains(&"bv*[height<=720]+ba/b[height<=720]/b".to_string()));
        assert!(args.contains(&"https://example.com/watch".to_string()));
    }

    #[test]
    fn media_url_download_args_do_not_add_browser_context_by_default() {
        for url in [
            "https://www.douyin.com/video/7642682043537800905",
            "https://www.bilibili.com/video/BV1ah5i6ZEJ3",
        ] {
            let input = MediaUrlDownloadInput {
                job_id: "job".into(),
                url: url.into(),
                title: Some("Demo".into()),
                kind: "video".into(),
                video_quality: Some("compact".into()),
                audio_format: None,
                subtitle_language: None,
                output_dir: None,
                use_browser_session: None,
                extra_args: None,
            };
            let args = build_media_url_download_args(&input, Path::new("/tmp/jc-media-job"), None).expect("build args");

            assert!(!args.contains(&"--cookies-from-browser".to_string()));
            assert!(!args.contains(&"--add-headers".to_string()));
        }
    }

    #[test]
    fn media_url_download_args_add_browser_context_only_when_requested() {
        let input = MediaUrlDownloadInput {
            job_id: "job".into(),
            url: "https://www.bilibili.com/video/BV1ah5i6ZEJ3".into(),
            title: Some("Demo".into()),
            kind: "video".into(),
            video_quality: Some("compact".into()),
            audio_format: None,
            subtitle_language: None,
            output_dir: None,
            use_browser_session: Some(true),
            extra_args: None,
        };
        let args = build_media_url_download_args(&input, Path::new("/tmp/jc-media-job"), None).expect("build args");

        assert!(args.contains(&"--cookies-from-browser".to_string()));
        assert!(args.contains(&"--add-headers".to_string()));
            assert!(args.iter().any(|value| value.starts_with("Referer:")));
            assert!(args.iter().any(|value| value.starts_with("User-Agent:")));
    }

    #[test]
    fn media_capture_browser_context_is_not_limited_to_known_sites() {
        let args = media_capture_site_args("https://example.com/watch/123", true);

        assert!(args.contains(&"--cookies-from-browser".to_string()));
        assert!(args.iter().any(|value| value == "chrome" || value == "safari"));
        assert!(!args.iter().any(|value| value.starts_with("Referer:")));
    }

    #[test]
    fn media_url_download_args_include_bundled_ffmpeg_location_when_available() {
        let input = MediaUrlDownloadInput {
            job_id: "job".into(),
            url: "https://example.com/watch".into(),
            title: Some("Demo".into()),
            kind: "video".into(),
            video_quality: Some("compact".into()),
            audio_format: None,
            subtitle_language: None,
            output_dir: None,
            use_browser_session: None,
            extra_args: None,
        };
        let ffmpeg = Path::new("/Applications/韭菜盒子.app/Contents/MacOS/ffmpeg");

        let args = build_media_url_download_args(&input, Path::new("/tmp/jc-media-job"), Some(ffmpeg))
            .expect("build args");

        assert!(args.contains(&"--ffmpeg-location".to_string()));
        assert!(args.contains(&ffmpeg.to_string_lossy().to_string()));
    }

    #[test]
    fn media_url_download_args_use_native_output_contract() {
        let output_dir = Path::new("/tmp/jc-media-job");
        let input = MediaUrlDownloadInput {
            job_id: "job".into(),
            url: "https://example.com/watch".into(),
            title: Some("Demo".into()),
            kind: "video".into(),
            video_quality: Some("best".into()),
            audio_format: None,
            subtitle_language: None,
            output_dir: None,
            use_browser_session: None,
            extra_args: None,
        };

        let args = build_media_url_download_args(&input, output_dir, None).expect("build args");

        assert!(args.contains(&"--paths".to_string()));
        assert!(args.contains(&output_dir.to_string_lossy().to_string()));
        assert!(args.contains(&"--output".to_string()));
        assert!(args.contains(&"%(title).200B [%(id)s].%(ext)s".to_string()));
        assert!(args.contains(&"--print".to_string()));
        assert!(args.contains(&"after_move:filepath".to_string()));
        assert!(!args.contains(&"-o".to_string()));
    }

    #[test]
    fn media_url_download_args_support_safe_internal_extra_args_only() {
        let mut input = MediaUrlDownloadInput {
            job_id: "job".into(),
            url: "https://example.com/watch".into(),
            title: Some("Demo".into()),
            kind: "video".into(),
            video_quality: Some("best".into()),
            audio_format: None,
            subtitle_language: None,
            output_dir: None,
            use_browser_session: None,
            extra_args: Some(vec!["--impersonate".into(), "chrome".into()]),
        };

        let args = build_media_url_download_args(&input, Path::new("/tmp/jc-media-job"), None)
            .expect("safe extra args");
        assert!(args.contains(&"--impersonate".to_string()));
        assert!(args.contains(&"chrome".to_string()));

        input.extra_args = Some(vec!["--exec".into(), "echo {}".into()]);
        let blocked = build_media_url_download_args(&input, Path::new("/tmp/jc-media-job"), None);
        assert!(blocked.is_err());
    }

    #[test]
    fn media_url_inspect_args_add_browser_context_only_when_requested() {
        let default_input = MediaUrlInspectInput {
            url: "https://www.bilibili.com/video/BV1ah5i6ZEJ3".into(),
            job_id: Some("job".into()),
            use_browser_session: None,
        };
        let browser_input = MediaUrlInspectInput {
            url: "https://www.bilibili.com/video/BV1ah5i6ZEJ3".into(),
            job_id: Some("job".into()),
            use_browser_session: Some(true),
        };

        let default_args = build_media_url_inspect_args(&default_input).expect("build default inspect args");
        let browser_args = build_media_url_inspect_args(&browser_input).expect("build browser inspect args");

        assert!(!default_args.contains(&"--cookies-from-browser".to_string()));
        assert!(browser_args.contains(&"--cookies-from-browser".to_string()));
        assert!(browser_args.contains(&"--add-headers".to_string()));
        assert!(browser_args.iter().any(|value| value.starts_with("Referer:")));
    }

    #[test]
    fn media_url_stream_detection_allows_download_when_codec_fields_are_missing() {
        let formats = vec![
            serde_json::json!({
                "format_id": "progressive",
                "ext": "mp4",
                "url": "https://cdn.example.com/video.mp4"
            }),
            serde_json::json!({
                "format_id": "audio",
                "ext": "m4a",
                "url": "https://cdn.example.com/audio.m4a"
            }),
        ];

        assert!(media_url_has_stream_kind(Some(&formats), "vcodec", &["mp4", "webm", "m3u8", "mpd", "mov", "mkv"]));
        assert!(media_url_has_stream_kind(Some(&formats), "acodec", &["m4a", "mp3", "aac", "opus", "webm", "wav", "flac"]));
        assert!(media_url_has_stream_kind(None, "vcodec", &["mp4"]));
    }

    #[test]
    fn media_url_output_selection_rejects_stdout_path_outside_output_dir() {
        let output_dir = temp_test_dir("media_url_output");
        let outside = temp_test_dir("media_url_outside").join("secret.mp4");
        std::fs::write(&outside, b"secret").expect("write outside file");

        let selected = select_media_url_output(
            &output_dir,
            "Demo",
            SystemTime::now(),
            &outside.to_string_lossy(),
        );

        assert!(selected.is_err());
    }

    #[test]
    fn media_url_output_selection_rejects_stdout_path_with_wrong_base() {
        let output_dir = temp_test_dir("media_url_wrong_base");
        let wrong = output_dir.join("Other.mp4");
        std::fs::write(&wrong, b"video").expect("write wrong output");

        let selected = select_media_url_output(
            &output_dir,
            "Demo",
            SystemTime::now(),
            "",
        );

        assert!(selected.is_err());
    }

    #[test]
    fn media_url_output_selection_accepts_after_move_path_without_name_prefix() {
        let output_dir = temp_test_dir("media_url_after_move");
        let output = output_dir.join("Native yt-dlp Title [abc123].mp4");
        std::fs::write(&output, b"video").expect("write output");

        let selected = select_media_url_output(
            &output_dir,
            "Different UI Title",
            SystemTime::now(),
            &output.to_string_lossy(),
        )
        .expect("select output");

        assert_eq!(selected, std::fs::canonicalize(output).expect("canonical output"));
    }

    #[test]
    fn media_capture_extra_args_reject_dangerous_native_options() {
        for arg in [
            "--exec",
            "--exec=echo {}",
            "--external-downloader",
            "--plugin-dirs",
            "--config-locations",
            "--enable-file-urls",
        ] {
            let result = validate_media_capture_extra_args(&[arg.to_string()]);
            assert!(result.is_err(), "expected {arg} to be rejected");
        }

        let safe = validate_media_capture_extra_args(&[
            "--impersonate".into(),
            "chrome".into(),
            "--retries".into(),
            "20".into(),
        ])
        .expect("safe args");
        assert_eq!(safe, ["--impersonate", "chrome", "--retries", "20"]);
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
    fn media_capture_errors_explain_browser_state_failures() {
        let douyin = media_capture_error_message("解析失败", "ERROR: [Douyin] Fresh cookies (not necessarily logged in) are needed");
        let bilibili = media_capture_error_message("解析失败", "ERROR: [BiliBili] Unable to download webpage: HTTP Error 412: Precondition Failed");

        assert!(douyin.contains("浏览器访问状态"));
        assert!(bilibili.contains("浏览器访问状态"));
        assert!(!douyin.contains("Fresh cookies"));
        assert!(!bilibili.contains("HTTP Error 412"));
    }

    #[test]
    fn media_capture_debug_candidates_include_documents_source_checkout() {
        let home = temp_test_dir("media_capture_home");
        let source_root = home.join("Documents").join("yt-dlp");
        std::fs::create_dir_all(source_root.join("yt_dlp")).expect("mkdir media source");
        std::fs::write(source_root.join("yt-dlp.sh"), "#!/usr/bin/env sh\n").expect("write wrapper");
        std::fs::write(source_root.join("yt_dlp").join("__main__.py"), "print('test')\n").expect("write module");

        let candidates = media_capture_command_candidates(None, Some(&home));

        #[cfg(debug_assertions)]
        {
            assert!(candidates.iter().any(|candidate| {
                candidate.display_path == source_root.join("yt-dlp.sh")
            }));
            assert!(candidates.iter().any(|candidate| {
                candidate.display_path == source_root
            }));
        }
    }

    #[test]
    fn media_capture_candidates_include_tauri_sidecar_executable_dir() {
        let sidecar_dir = temp_test_dir("media_capture_sidecar");
        std::fs::write(sidecar_dir.join("yt-dlp"), "#!/usr/bin/env sh\n").expect("write sidecar");

        let mut candidates = Vec::new();
        push_media_capture_directory_candidates(&mut candidates, &sidecar_dir);

        assert!(candidates.iter().any(|candidate| {
            candidate.display_path == sidecar_dir.join("yt-dlp")
        }));
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
    fn failed_ocr_report_is_not_valid_markdown_cache() {
        let content = r#"# 编剧心理学

- 来源文件：/tmp/book.pdf
- 总页数：2
- 已处理页数：2
- OCR 失败页数：2

## OCR 失败页
- 第 1 页：RapidOCR 转换失败: RapidOCR 本地引擎不可用：Error importing numpy
- 第 2 页：RapidOCR 转换失败: RapidOCR 本地引擎不可用：Error importing numpy

<!-- source-page: 1 -->
## 第 1 页

> 本页 OCR 未成功，已保留占位。原因：RapidOCR 转换失败: RapidOCR 本地引擎不可用：Error importing numpy

<!-- source-page: 2 -->
## 第 2 页

> 本页 OCR 未成功，已保留占位。原因：RapidOCR 转换失败: RapidOCR 本地引擎不可用：Error importing numpy
"#;

        assert!(is_meaningful_markdown(content));
        assert!(!is_successful_markdown_content(content));
        assert!(!is_successful_ocr_markdown(content));
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
    fn empty_rapidocr_page_is_not_successful_ocr_output() {
        let content = r#"<!-- source-page: 1 -->
## 第 1 页

> 本页未识别到文字。
"#;

        assert!(!is_successful_ocr_markdown(content));
    }

    #[test]
    fn normal_markdown_is_valid_cache_content() {
        let content = r#"# 第一章 故事结构

这一章讲三幕式结构、人物目标和反击战的节奏设计。
"#;

        assert!(is_successful_markdown_content(content));
        assert!(is_successful_ocr_markdown(content));
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
                        // 播种内置预设 Skill 到 ~/.agents/skills/
                        if let Some(ref src) = skills_src {
                            if let Err(e) = skills::db::seed_preset_skills(&pool, src).await {
                                eprintln!("[JC] seed preset skills failed: {e}");
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
            commands::opencode::opencode_mcp_status,
            commands::opencode::opencode_ensure_server,
            commands::opencode::opencode_stop,
            commands::opencode::opencode_relaunch,
            commands::opencode::opencode_export_debug_logs,
            commands::greet::save_generated_file,
            commands::dev::dev_detect_project,
            commands::dev::dev_list_files,
            commands::dev::dev_search_text,
            commands::dev::dev_file_exists,
            commands::dev::dev_read_file,
            commands::dev::dev_read_many_files,
            commands::dev::dev_write_file,
            commands::dev::dev_write_file_bytes,
            commands::dev::dev_rename_file,
            commands::dev::dev_replace_file,
            commands::dev::dev_delete_file,
            commands::dev::dev_create_dir,
            commands::dev::dev_reveal_in_finder,
            commands::dev::scaffold_vault,
            commands::dev::dev_replace_in_file,
            commands::dev::dev_get_diff,
            commands::dev::dev_run_command,
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
            commands::obsidian::check_obsidian_installed,
            commands::tools::check_tool_installed,
            commands::tools::check_opencode_plugin,
            commands::tools::check_all_tools,
            commands::obsidian::mdfind_obsidian,
            commands::dev::scaffold_vault,
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

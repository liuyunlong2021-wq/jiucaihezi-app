use crate::commands::tools::{
    local_tools_python_path, resolve_app_media_binary, resolve_local_python,
};
use crate::*;
use base64::{Engine as _, engine::general_purpose};
use sha2::{Digest, Sha256};
use std::env;
use std::path::{Component, Path, PathBuf};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;
use tokio::process::Command;
use tokio::sync::Semaphore;
use tokio::time::timeout;

const MAX_DOCUMENT_BYTES: usize = 100 * 1024 * 1024;
const ANYDOC_CONVERTER_VERSION: &str = "0.2.3";
const DOCUMENT_OUTPUT_SCHEMA_VERSION: u8 = 1;
static DOCUMENT_PARSE_PERMITS: Semaphore = Semaphore::const_new(2);

pub fn app_media_dir(app: &tauri::AppHandle, name: &str) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("获取应用数据目录失败: {}", e))?
        .join(name);
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建媒体目录失败: {}", e))?;
    std::fs::canonicalize(&dir).map_err(|e| format!("媒体目录不可访问: {}", e))
}

pub fn sanitize_media_filename(filename: &str, fallback: &str) -> String {
    let raw = Path::new(filename)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or(fallback);
    let cleaned = raw
        .chars()
        .map(|ch| {
            if ch.is_alphanumeric() || matches!(ch, '.' | '_' | '-') {
                ch
            } else {
                '_'
            }
        })
        .collect::<String>()
        .trim_matches('_')
        .to_string();
    if cleaned.is_empty() {
        fallback.to_string()
    } else {
        cleaned
    }
}

pub fn unique_media_filename(filename: &str) -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    format!("{}_{}", now, sanitize_media_filename(filename, "media.bin"))
}

pub fn media_file_stem(filename: &str) -> String {
    Path::new(filename)
        .file_stem()
        .and_then(|value| value.to_str())
        .map(|value| sanitize_media_filename(value, "media"))
        .unwrap_or_else(|| "media".into())
}

pub fn strip_data_url_prefix(data: &str) -> &str {
    data.split_once(',')
        .map(|(_, payload)| payload)
        .unwrap_or(data)
}

pub fn markdown_output_filename(filename: &str) -> String {
    let safe = sanitize_media_filename(filename, "document");
    let base = Path::new(&safe)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("document")
        .trim_matches('_');
    let base = if base.is_empty() { "document" } else { base };
    format!("{}.md", base)
}

pub fn converted_output_filename(filename: &str, output_format: &str) -> String {
    let safe = sanitize_media_filename(filename, "document");
    let base = Path::new(&safe)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("document")
        .trim_matches('_');
    let base = if base.is_empty() { "document" } else { base };
    format!("{}.{}", base, output_format)
}

pub fn available_output_path(dir: &Path, filename: &str) -> PathBuf {
    let safe = sanitize_media_filename(filename, "document.md");
    let path = dir.join(&safe);
    if !path.exists() {
        return path;
    }

    let stem = Path::new(&safe)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("document");
    let ext = Path::new(&safe)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("md");

    for index in 2..1000 {
        let candidate = dir.join(format!("{}_{}.{}", stem, index, ext));
        if !candidate.exists() {
            return candidate;
        }
    }

    dir.join(unique_media_filename(&safe))
}

pub fn meaningful_text_char_count(content: &str) -> usize {
    let mut cleaned = String::with_capacity(content.len());
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("[第") && trimmed.ends_with("页]") {
            continue;
        }
        if trimmed.to_ascii_lowercase().starts_with("[page") && trimmed.ends_with(']') {
            continue;
        }
        for ch in trimmed.chars() {
            if ch.is_alphanumeric() {
                cleaned.push(ch);
            }
        }
    }
    cleaned.chars().count()
}

pub fn is_meaningful_markdown(content: &str) -> bool {
    meaningful_text_char_count(content) >= 2
}

#[cfg_attr(not(test), allow(dead_code))]
pub fn is_successful_markdown_content(content: &str) -> bool {
    is_meaningful_markdown(content)
}

pub fn truncate_markdown(content: String, max_chars: usize) -> (String, bool) {
    let max = max_chars.clamp(1, 20_000_000);
    if content.chars().count() <= max {
        return (content, false);
    }
    (content.chars().take(max).collect(), true)
}

pub fn python_command_with_local_tools() -> Command {
    let mut command = Command::new(resolve_local_python());
    if let Some(python_path) = local_tools_python_path() {
        command.env("PYTHONPATH", python_path.to_string_lossy().to_string());
    }
    command
        .env("PYTHONNOUSERSITE", "1")
        .env_remove("PYTHONHOME")
        .current_dir(env::temp_dir());
    command
}

pub fn is_image_path(source: &Path) -> bool {
    source
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| {
            matches!(
                value.to_ascii_lowercase().as_str(),
                "png" | "jpg" | "jpeg" | "webp" | "bmp" | "gif" | "tif" | "tiff" | "heic" | "heif"
            )
        })
        .unwrap_or(false)
}

fn document_parse_error(code: &str, message: impl Into<String>) -> DocumentParseError {
    DocumentParseError {
        code: code.into(),
        message: message.into(),
    }
}

fn decorate_document_markdown(bytes: &[u8], content: &str) -> String {
    let metadata = serde_json::json!({
        "sourceSha256": format!("{:x}", Sha256::digest(bytes)),
        "converterId": "anydoc",
        "converterVersion": ANYDOC_CONVERTER_VERSION,
        "outputSchemaVersion": DOCUMENT_OUTPUT_SCHEMA_VERSION,
        "contentSha256": format!("{:x}", Sha256::digest(content.as_bytes())),
    });
    format!(
        "<!-- jc-document-conversion {} -->\n\n{}",
        metadata, content
    )
}

fn document_markdown_body(content: &str) -> &str {
    content
        .strip_prefix("<!-- jc-document-conversion ")
        .and_then(|value| value.split_once(" -->\n\n"))
        .map(|(_, body)| body)
        .unwrap_or(content)
}

#[cfg(not(any(target_os = "ios", target_os = "android")))]
pub(crate) fn map_anydoc_error(error: anydoc::ConvertError, is_pdf: bool) -> DocumentParseError {
    use anydoc::ConvertError;

    match error {
        ConvertError::Unsupported(detail)
            if is_pdf && detail.to_ascii_lowercase().contains("ocr") =>
        {
            document_parse_error(
                "ocr_required",
                "PDF 没有可提取的文字层；扫描版或图片型 PDF 需要先进行 OCR。",
            )
        }
        ConvertError::Unsupported(_) => {
            document_parse_error("unsupported", "不支持该文档格式或文件没有可提取内容。")
        }
        ConvertError::Malformed { .. } => {
            document_parse_error("malformed", "文档结构损坏，无法读取有效内容。")
        }
        ConvertError::Encrypted => {
            document_parse_error("encrypted", "文档已加密或受密码保护，无法读取。")
        }
        ConvertError::ResourceLimit { .. } => {
            document_parse_error("resource_limit", "文档超过本地安全解析上限。")
        }
        ConvertError::MissingPart { .. } => {
            document_parse_error("missing_part", "文档缺少必要内容，无法完整读取。")
        }
        ConvertError::Io(_) => document_parse_error("internal", "读取本地文档失败。"),
        _ => document_parse_error("internal", "AnyDoc 本地解析失败。"),
    }
}

#[cfg(not(any(target_os = "ios", target_os = "android")))]
fn parse_document_markdown(bytes: &[u8], filename: &str) -> Result<String, DocumentParseError> {
    if bytes.len() > MAX_DOCUMENT_BYTES {
        return Err(document_parse_error(
            "resource_limit",
            "文档超过本地 100 MB 安全解析上限。",
        ));
    }

    let detected = anydoc::Format::from_bytes(bytes);
    let named = Path::new(filename)
        .extension()
        .and_then(|value| value.to_str())
        .and_then(anydoc::Format::from_extension);
    let format = detected.or(named);
    let is_pdf = format == Some(anydoc::Format::Pdf);
    let content = anydoc::to_markdown_bytes(bytes, format)
        .map_err(|error| map_anydoc_error(error, is_pdf))?;
    if !is_successful_markdown_content(&content) {
        return Err(document_parse_error(
            if is_pdf { "ocr_required" } else { "malformed" },
            if is_pdf {
                "PDF 没有可提取的文字层；扫描版或图片型 PDF 需要先进行 OCR。"
            } else {
                "文档没有提取到有效正文。"
            },
        ));
    }
    Ok(decorate_document_markdown(bytes, &content))
}

#[cfg(not(any(target_os = "ios", target_os = "android")))]
pub(crate) fn parse_document_bytes(
    bytes: &[u8],
    filename: &str,
    max_chars: usize,
) -> Result<MarkdownConversion, DocumentParseError> {
    let content = parse_document_markdown(bytes, filename)?;
    let (content, truncated) = truncate_markdown(content, max_chars);
    Ok(MarkdownConversion {
        content,
        engine: "anydoc".into(),
        truncated,
        message: "已使用内置 AnyDoc 生成 Markdown。".into(),
    })
}

pub fn write_text_file(path: &Path, content: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建输出目录失败: {}", e))?;
    }
    std::fs::write(path, content).map_err(|e| format!("写入文件失败: {}", e))
}

pub(crate) fn validate_document_project_paths(
    source_path: &Path,
    output_dir: &Path,
) -> Result<(PathBuf, PathBuf), String> {
    let source = std::fs::canonicalize(source_path).map_err(|_| "源文件不可访问。".to_string())?;
    if !source.is_file() {
        return Err("源文件不是有效文件。".into());
    }
    let output =
        std::fs::canonicalize(output_dir).map_err(|_| "文档输出目录不可访问。".to_string())?;
    let is_document_material_dir = output.file_name().and_then(|v| v.to_str()) == Some("文档")
        && output
            .parent()
            .and_then(|v| v.file_name())
            .and_then(|v| v.to_str())
            == Some("jc-media")
        && output
            .parent()
            .and_then(|v| v.parent())
            .and_then(|v| v.file_name())
            .and_then(|v| v.to_str())
            == Some(".raw");
    if !is_document_material_dir {
        return Err("文档输出目录必须位于项目的 .raw/jc-media/文档 目录。".into());
    }
    let project_root = output
        .parent()
        .and_then(|v| v.parent())
        .and_then(|v| v.parent())
        .ok_or_else(|| "无法确定项目根目录。".to_string())?;
    if !source.starts_with(project_root) {
        return Err("源文件必须位于当前项目目录内。".into());
    }
    Ok((source, output))
}

pub fn normalize_output_format(value: Option<&str>) -> String {
    match value
        .unwrap_or("md")
        .trim()
        .trim_start_matches('.')
        .to_ascii_lowercase()
        .as_str()
    {
        "markdown" => "md".into(),
        "md" | "txt" | "html" | "csv" | "json" | "srt" => value
            .unwrap_or("md")
            .trim()
            .trim_start_matches('.')
            .to_ascii_lowercase(),
        _ => "md".into(),
    }
}

pub fn strip_markdown_for_plain_text(markdown: &str) -> String {
    let mut out = String::new();
    let mut in_code = false;
    for line in markdown.replace("\r\n", "\n").replace('\r', "\n").lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("```") {
            in_code = !in_code;
            continue;
        }
        let mut value = if in_code {
            line.to_string()
        } else {
            trimmed
                .trim_start_matches('#')
                .trim_start_matches('>')
                .trim_start_matches("- ")
                .trim_start_matches("* ")
                .replace("**", "")
                .replace("__", "")
                .replace('`', "")
                .replace('*', "")
                .replace('_', "")
        };
        if value.starts_with("![") {
            continue;
        }
        while let Some(start) = value.find('[') {
            let Some(mid) = value[start..].find("](").map(|index| start + index) else {
                break;
            };
            let Some(end) = value[mid + 2..].find(')').map(|index| mid + 2 + index) else {
                break;
            };
            let label = value[start + 1..mid].to_string();
            value.replace_range(start..=end, &label);
        }
        if !value.trim().is_empty() {
            out.push_str(value.trim());
            out.push('\n');
        }
    }
    out
}

pub fn escape_html_text(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

pub fn markdown_to_simple_html(markdown: &str) -> String {
    let mut body = String::new();
    let mut in_code = false;
    for line in markdown.replace("\r\n", "\n").replace('\r', "\n").lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("```") {
            if in_code {
                body.push_str("</code></pre>\n");
            } else {
                body.push_str("<pre><code>");
            }
            in_code = !in_code;
            continue;
        }
        if in_code {
            body.push_str(&escape_html_text(line));
            body.push('\n');
            continue;
        }
        if trimmed.is_empty() {
            continue;
        }
        if let Some(heading) = trimmed.strip_prefix("###### ") {
            body.push_str(&format!("<h6>{}</h6>\n", escape_html_text(heading)));
        } else if let Some(heading) = trimmed.strip_prefix("##### ") {
            body.push_str(&format!("<h5>{}</h5>\n", escape_html_text(heading)));
        } else if let Some(heading) = trimmed.strip_prefix("#### ") {
            body.push_str(&format!("<h4>{}</h4>\n", escape_html_text(heading)));
        } else if let Some(heading) = trimmed.strip_prefix("### ") {
            body.push_str(&format!("<h3>{}</h3>\n", escape_html_text(heading)));
        } else if let Some(heading) = trimmed.strip_prefix("## ") {
            body.push_str(&format!("<h2>{}</h2>\n", escape_html_text(heading)));
        } else if let Some(heading) = trimmed.strip_prefix("# ") {
            body.push_str(&format!("<h1>{}</h1>\n", escape_html_text(heading)));
        } else {
            body.push_str(&format!("<p>{}</p>\n", escape_html_text(trimmed)));
        }
    }
    format!(
        "<!doctype html>\n<html lang=\"zh-CN\">\n<head><meta charset=\"utf-8\"><title>韭菜盒子转换</title></head>\n<body>\n{}</body>\n</html>\n",
        body
    )
}

pub fn split_markdown_table_row(line: &str) -> Vec<String> {
    line.trim()
        .trim_matches('|')
        .split('|')
        .map(|cell| cell.trim().replace("\\|", "|"))
        .collect()
}

pub fn is_markdown_table_separator(line: &str) -> bool {
    line.trim().trim_matches('|').split('|').all(|cell| {
        cell.trim().chars().all(|ch| matches!(ch, '-' | ':' | ' ')) && cell.contains('-')
    })
}

pub fn csv_escape(value: &str) -> String {
    if value.contains(',') || value.contains('"') || value.contains('\n') {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_string()
    }
}

pub fn markdown_table_to_csv(markdown: &str) -> Option<String> {
    let lines = markdown.lines().collect::<Vec<_>>();
    for index in 0..lines.len().saturating_sub(1) {
        if !lines[index].contains('|') || !is_markdown_table_separator(lines[index + 1]) {
            continue;
        }
        let mut rows = vec![split_markdown_table_row(lines[index])];
        let mut cursor = index + 2;
        while cursor < lines.len()
            && lines[cursor].contains('|')
            && !lines[cursor].trim().is_empty()
        {
            rows.push(split_markdown_table_row(lines[cursor]));
            cursor += 1;
        }
        if rows.len() < 2 {
            return None;
        }
        let csv = rows
            .into_iter()
            .map(|row| {
                row.into_iter()
                    .map(|cell| csv_escape(&cell))
                    .collect::<Vec<_>>()
                    .join(",")
            })
            .collect::<Vec<_>>()
            .join("\n");
        return Some(format!("{}\n", csv));
    }
    None
}

pub fn strip_single_code_fence(content: &str, lang: &str) -> String {
    let trimmed = content.trim();
    let lower = trimmed.to_ascii_lowercase();
    if lower.starts_with(&format!("```{}", lang)) && trimmed.ends_with("```") {
        let without_start = trimmed.lines().skip(1).collect::<Vec<_>>().join("\n");
        return without_start.trim_end_matches("```").trim().to_string();
    }
    if trimmed.starts_with("```") && trimmed.ends_with("```") {
        let without_start = trimmed.lines().skip(1).collect::<Vec<_>>().join("\n");
        return without_start.trim_end_matches("```").trim().to_string();
    }
    trimmed.to_string()
}

pub fn looks_like_srt(content: &str) -> bool {
    content.contains("-->")
        && content
            .lines()
            .any(|line| line.trim().parse::<usize>().is_ok())
}

pub fn convert_markdown_for_output(output_format: &str, markdown: &str) -> Result<String, String> {
    match output_format {
        "md" => Ok(markdown.trim_end().to_string() + "\n"),
        "txt" => Ok(strip_markdown_for_plain_text(markdown)),
        "html" => Ok(markdown_to_simple_html(markdown)),
        "csv" => {
            let plain = strip_markdown_for_plain_text(markdown);
            if plain
                .lines()
                .take(5)
                .filter(|line| line.contains(','))
                .count()
                >= 2
            {
                return Ok(plain);
            }
            markdown_table_to_csv(markdown)
                .ok_or_else(|| "没有检测到可导出 CSV 的表格内容。".into())
        }
        "json" => {
            let candidate = strip_single_code_fence(markdown, "json");
            let value: serde_json::Value = serde_json::from_str(&candidate)
                .map_err(|_| "没有检测到有效 JSON 内容。".to_string())?;
            serde_json::to_string_pretty(&value)
                .map(|value| format!("{}\n", value))
                .map_err(|e| format!("JSON 格式化失败: {}", e))
        }
        "srt" => {
            let candidate = strip_single_code_fence(markdown, "srt");
            if looks_like_srt(&candidate) {
                Ok(candidate.trim_end().to_string() + "\n")
            } else {
                Err("没有检测到有效 SRT 字幕内容。".into())
            }
        }
        _ => Ok(markdown.trim_end().to_string() + "\n"),
    }
}

pub fn validate_selected_media_path(input_path: &str) -> Result<PathBuf, String> {
    let raw = input_path.trim();
    if raw.is_empty() || raw.contains('\0') {
        return Err("请选择有效的音频或视频文件。".into());
    }
    let path = PathBuf::from(raw);
    if !path.is_absolute() {
        return Err("请选择有效的音频或视频文件。".into());
    }
    if path
        .components()
        .any(|part| matches!(part, Component::ParentDir))
    {
        return Err("文件路径不安全，请重新选择文件。".into());
    }
    let canonical =
        std::fs::canonicalize(&path).map_err(|_| "文件不可访问，请重新选择。".to_string())?;
    if !canonical.is_file() {
        return Err("请选择有效的音频或视频文件。".into());
    }
    Ok(canonical)
}

pub async fn resolve_media_input_path(
    app: &tauri::AppHandle,
    jobs: &MediaCaptureJobs,
    input_path: &str,
) -> Result<PathBuf, String> {
    let cache_dir = app_media_dir(app, "media-cache")?;
    let path = validate_selected_media_path(input_path)?;
    if path.starts_with(&cache_dir) || jobs.is_allowed_input(&path).await {
        return Ok(path);
    }
    Err("请选择工具中添加的音频或视频文件。".into())
}

pub fn parse_fps(raw: &str) -> Option<f64> {
    let value = raw.trim();
    if value.is_empty() || value == "0/0" {
        return None;
    }
    if let Some((left, right)) = value.split_once('/') {
        let numerator = left.parse::<f64>().ok()?;
        let denominator = right.parse::<f64>().ok()?;
        if denominator <= 0.0 {
            return None;
        }
        return Some(numerator / denominator);
    }
    value.parse::<f64>().ok()
}

pub fn media_kind(has_video: bool, has_audio: bool) -> String {
    if has_video {
        "video".into()
    } else if has_audio {
        "audio".into()
    } else {
        "unknown".into()
    }
}

pub async fn inspect_media_path(
    app: &tauri::AppHandle,
    source: &Path,
) -> Result<MediaInspectFileOutput, String> {
    let metadata =
        std::fs::metadata(source).map_err(|_| "文件不可访问，请重新选择。".to_string())?;
    let filename = source
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("media")
        .to_string();
    let fallback_format = source
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_uppercase();

    let output = timeout(
        Duration::from_secs(20),
        Command::new(resolve_app_media_binary(app, "ffprobe")?)
            .args([
                "-v",
                "error",
                "-print_format",
                "json",
                "-show_format",
                "-show_streams",
                &source.to_string_lossy(),
            ])
            .kill_on_drop(true)
            .output(),
    )
    .await
    .map_err(|_| "读取媒体信息超时，请稍后重试。".to_string())?
    .map_err(|_| "媒体处理组件暂时不可用，请重启应用后重试。".to_string())?;

    if !output.status.success() {
        return Err("无法读取这个媒体文件的信息。".into());
    }

    let data: serde_json::Value =
        serde_json::from_slice(&output.stdout).map_err(|_| "媒体信息格式不可识别。".to_string())?;
    let streams = data
        .get("streams")
        .and_then(|value| value.as_array())
        .cloned()
        .unwrap_or_default();
    let mut width = None;
    let mut height = None;
    let mut fps = None;
    let mut audio_codec = None;
    let mut video_codec = None;
    let mut has_audio = false;
    let mut has_video = false;
    let mut has_subtitles = false;

    for stream in streams {
        let codec_type = stream
            .get("codec_type")
            .and_then(|value| value.as_str())
            .unwrap_or("");
        match codec_type {
            "video" => {
                has_video = true;
                if width.is_none() {
                    width = stream.get("width").and_then(|value| value.as_u64());
                    height = stream.get("height").and_then(|value| value.as_u64());
                    fps = stream
                        .get("avg_frame_rate")
                        .or_else(|| stream.get("r_frame_rate"))
                        .and_then(|value| value.as_str())
                        .and_then(parse_fps);
                    video_codec = stream
                        .get("codec_name")
                        .and_then(|value| value.as_str())
                        .map(str::to_string);
                }
            }
            "audio" => {
                has_audio = true;
                if audio_codec.is_none() {
                    audio_codec = stream
                        .get("codec_name")
                        .and_then(|value| value.as_str())
                        .map(str::to_string);
                }
            }
            "subtitle" => {
                has_subtitles = true;
            }
            _ => {}
        }
    }

    let duration_seconds = data
        .get("format")
        .and_then(|value| value.get("duration"))
        .and_then(|value| value.as_str())
        .and_then(|value| value.parse::<f64>().ok());
    let format = data
        .get("format")
        .and_then(|value| value.get("format_name"))
        .and_then(|value| value.as_str())
        .map(|value| {
            value
                .split(',')
                .next()
                .unwrap_or(value)
                .to_ascii_uppercase()
        })
        .filter(|value| !value.is_empty())
        .unwrap_or(fallback_format);

    Ok(MediaInspectFileOutput {
        input_path: source.to_string_lossy().to_string(),
        filename,
        size: metadata.len(),
        format,
        kind: media_kind(has_video, has_audio),
        duration_seconds,
        width,
        height,
        fps,
        audio_codec,
        video_codec,
        has_audio,
        has_video,
        has_subtitles,
    })
}

pub fn audio_codec(format: &str) -> &'static str {
    match format {
        "wav" => "pcm_s16le",
        "flac" => "flac",
        "ogg" => "libvorbis",
        "aac" => "aac",
        _ => "libmp3lame",
    }
}

pub fn supported_media_format(format: &str) -> bool {
    matches!(
        format,
        "mp4" | "mov" | "webm" | "mkv" | "mp3" | "wav" | "aac" | "flac" | "ogg"
    )
}

pub fn build_ffmpeg_args(
    input: &MediaProcessFileInput,
    source: &Path,
    output: &Path,
) -> Result<Vec<String>, String> {
    let action = input.action.trim().to_ascii_lowercase();
    let format = input
        .target_format
        .trim()
        .trim_start_matches('.')
        .to_ascii_lowercase();
    if !supported_media_format(&format) {
        return Err(format!("不支持的目标格式: {}", format));
    }

    let source_str = source.to_string_lossy().to_string();
    let output_str = output.to_string_lossy().to_string();
    let mut args = vec!["-y".into(), "-hide_banner".into(), "-i".into(), source_str];

    match action.as_str() {
        "compress" => {
            let crf = input.crf.unwrap_or(23).clamp(18, 35).to_string();
            args.extend([
                "-c:v".into(),
                "libx264".into(),
                "-crf".into(),
                crf,
                "-preset".into(),
                "medium".into(),
                "-c:a".into(),
                "aac".into(),
                "-b:a".into(),
                "128k".into(),
                output_str,
            ]);
        }
        "convert" => {
            match format.as_str() {
                "webm" => args.extend([
                    "-c:v".into(),
                    "libvpx-vp9".into(),
                    "-c:a".into(),
                    "libopus".into(),
                ]),
                "mkv" => args.extend(["-c".into(), "copy".into()]),
                "mp3" | "wav" | "aac" | "flac" | "ogg" => {
                    args.extend(["-vn".into(), "-acodec".into(), audio_codec(&format).into()])
                }
                _ => args.extend(["-c:v".into(), "libx264".into(), "-c:a".into(), "aac".into()]),
            }
            args.push(output_str);
        }
        "extract_audio" => {
            args.extend([
                "-vn".into(),
                "-acodec".into(),
                audio_codec(&format).into(),
                output_str,
            ]);
        }
        "trim" => {
            let start = input.start_seconds.unwrap_or(0.0).max(0.0);
            let Some(end) = input.end_seconds else {
                return Err("截取媒体需要提供 end_seconds。".into());
            };
            if end <= start {
                return Err("end_seconds 必须大于 start_seconds。".into());
            }
            args.extend([
                "-ss".into(),
                format!("{:.3}", start),
                "-to".into(),
                format!("{:.3}", end),
                "-c".into(),
                "copy".into(),
                output_str,
            ]);
        }
        "mute" => {
            args.extend(["-an".into(), "-c:v".into(), "copy".into(), output_str]);
        }
        _ => return Err(format!("不支持的媒体处理动作: {}", action)),
    }

    Ok(args)
}

pub fn supported_transcript_format(format: &str) -> bool {
    matches!(format, "txt" | "srt" | "vtt" | "json")
}

pub fn find_transcript_output(
    output_dir: &Path,
    stem: &str,
    format: &str,
    started_at: SystemTime,
) -> Option<PathBuf> {
    let direct = output_dir.join(format!("{}.{}", stem, format));
    if direct.exists()
        && std::fs::metadata(&direct)
            .ok()
            .and_then(|metadata| metadata.modified().ok())
            .is_some_and(|modified| {
                modified
                    >= started_at
                        .checked_sub(Duration::from_secs(5))
                        .unwrap_or(started_at)
            })
    {
        return Some(direct);
    }
    let mut candidates = std::fs::read_dir(output_dir)
        .ok()?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.extension().and_then(|value| value.to_str()) == Some(format))
        .filter(|path| {
            path.file_stem()
                .and_then(|value| value.to_str())
                .is_some_and(|value| value.starts_with(stem))
        })
        .filter_map(|path| {
            let modified = std::fs::metadata(&path).ok()?.modified().ok()?;
            if modified
                < started_at
                    .checked_sub(Duration::from_secs(5))
                    .unwrap_or(started_at)
            {
                return None;
            }
            Some((modified, path))
        })
        .collect::<Vec<_>>();
    candidates.sort_by_key(|(modified, _)| *modified);
    candidates.pop().map(|(_, path)| path)
}

pub fn escape_subtitle_filter_path(path: &Path) -> String {
    path.to_string_lossy()
        .replace('\\', "\\\\")
        .replace('\'', "\\'")
        .replace(':', "\\:")
}

#[tauri::command]
pub fn media_cache_file(
    app: tauri::AppHandle,
    input: MediaCacheFileInput,
) -> Result<MediaCacheFileOutput, String> {
    let cache_dir = app_media_dir(&app, "media-cache")?;
    let filename = unique_media_filename(&input.filename);
    let path = cache_dir.join(&filename);
    let payload = strip_data_url_prefix(input.data_base64.trim());
    let bytes = general_purpose::STANDARD
        .decode(payload)
        .map_err(|e| format!("媒体文件解码失败: {}", e))?;
    std::fs::write(&path, &bytes).map_err(|e| format!("缓存媒体文件失败: {}", e))?;
    let size = std::fs::metadata(&path)
        .map_err(|e| format!("读取媒体缓存失败: {}", e))?
        .len();
    Ok(MediaCacheFileOutput {
        input_path: path.to_string_lossy().to_string(),
        filename,
        size,
    })
}

pub async fn convert_source_to_markdown(
    source_path: &Path,
    output_path: &Path,
    max_chars: usize,
) -> Result<MarkdownConversion, DocumentParseError> {
    if is_image_path(source_path) {
        return Err(document_parse_error(
            "unsupported",
            "图片不是可转换文档；请先使用 OCR 工具生成文字文件后再导入。",
        ));
    }

    #[cfg(not(any(target_os = "ios", target_os = "android")))]
    {
        let permit = DOCUMENT_PARSE_PERMITS
            .acquire()
            .await
            .map_err(|_| document_parse_error("internal", "AnyDoc 本地解析不可用。"))?;
        let source_path = source_path.to_path_buf();
        let filename = source_path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("document")
            .to_string();
        let conversion = timeout(
            Duration::from_secs(90),
            tokio::task::spawn_blocking(move || {
                // ponytail: a timed-out blocking parse keeps its permit until it exits; use a
                // helper process only if hard cancellation becomes a measured requirement.
                let _permit = permit;
                let bytes = std::fs::read(source_path)
                    .map_err(|_| document_parse_error("internal", "读取本地文档失败。"))?;
                let markdown = parse_document_markdown(&bytes, &filename)?;
                let (content, truncated) = truncate_markdown(markdown.clone(), max_chars);
                Ok::<_, DocumentParseError>((
                    markdown,
                    MarkdownConversion {
                        content,
                        engine: "anydoc".into(),
                        truncated,
                        message: "已使用内置 AnyDoc 生成 Markdown。".into(),
                    },
                ))
            }),
        )
        .await
        .map_err(|_| document_parse_error("internal", "AnyDoc 本地解析超时。"))?
        .map_err(|_| document_parse_error("internal", "AnyDoc 本地解析异常。"))??;
        let (markdown, conversion) = conversion;
        write_text_file(output_path, &markdown)
            .map_err(|message| document_parse_error("internal", message))?;
        return Ok(conversion);
    }

    #[cfg(any(target_os = "ios", target_os = "android"))]
    Err(document_parse_error(
        "unsupported",
        "移动端请使用云端文档转换。",
    ))
}

pub fn markdown_success_output(
    source: String,
    source_path: &Path,
    output_path: &Path,
    fallback_filename: &str,
    conversion: MarkdownConversion,
) -> DocumentToMarkdownFileOutput {
    DocumentToMarkdownFileOutput {
        status: "success".into(),
        source,
        filename: output_path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or(fallback_filename)
            .to_string(),
        content: conversion.content,
        engine: conversion.engine,
        source_path: source_path.to_string_lossy().to_string(),
        output_path: output_path.to_string_lossy().to_string(),
        truncated: conversion.truncated,
        message: conversion.message,
        error: None,
        error_code: None,
    }
}

pub fn markdown_error_output(
    source: String,
    source_path: &Path,
    output_path: &Path,
    fallback_filename: &str,
    error: DocumentParseError,
) -> DocumentToMarkdownFileOutput {
    DocumentToMarkdownFileOutput {
        status: "error".into(),
        source,
        filename: output_path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or(fallback_filename)
            .to_string(),
        content: String::new(),
        engine: "unsupported".into(),
        source_path: source_path.to_string_lossy().to_string(),
        output_path: output_path.to_string_lossy().to_string(),
        truncated: false,
        message: error.message.clone(),
        error: Some(error.message),
        error_code: Some(error.code),
    }
}

pub fn finalize_markdown_conversion_output(
    source_name: String,
    source_path: &Path,
    markdown_path: &Path,
    final_path: &Path,
    fallback_filename: &str,
    output_format: &str,
    mut conversion: MarkdownConversion,
    max_chars: usize,
) -> Result<DocumentToMarkdownFileOutput, String> {
    if output_format == "md" {
        return Ok(markdown_success_output(
            source_name,
            source_path,
            final_path,
            fallback_filename,
            conversion,
        ));
    }

    let markdown =
        std::fs::read_to_string(markdown_path).unwrap_or_else(|_| conversion.content.clone());
    let output_content =
        convert_markdown_for_output(output_format, document_markdown_body(&markdown))?;
    write_text_file(final_path, &output_content)?;
    let _ = std::fs::remove_file(markdown_path);
    let (content, truncated) = truncate_markdown(output_content, max_chars);
    conversion.content = content;
    conversion.truncated = truncated;
    conversion.message = format!("已生成 {} 文件。", output_format.to_uppercase());

    Ok(markdown_success_output(
        source_name,
        source_path,
        final_path,
        fallback_filename,
        conversion,
    ))
}

#[tauri::command]
pub async fn document_to_markdown_file(
    app: tauri::AppHandle,
    input: DocumentToMarkdownFileInput,
) -> Result<DocumentToMarkdownFileOutput, String> {
    let source_dir = app_media_dir(&app, "document-markdown-inputs")?;
    let output_dir = app_media_dir(&app, "document-markdown-outputs")?;
    let source_filename = unique_media_filename(&input.filename);
    let source_path = source_dir.join(&source_filename);
    let output_format = normalize_output_format(input.output_format.as_deref());
    let output_filename = converted_output_filename(&input.filename, &output_format);
    let output_path = output_dir.join(unique_media_filename(&output_filename));
    let markdown_output_filename = markdown_output_filename(&input.filename);
    let markdown_output_path = if output_format == "md" {
        output_path.clone()
    } else {
        output_dir.join(unique_media_filename(&markdown_output_filename))
    };
    let max_chars = input.max_chars.unwrap_or(20_000_000);

    let payload = strip_data_url_prefix(input.data_base64.trim());
    if payload.len() > (MAX_DOCUMENT_BYTES * 4 / 3) + 4 {
        return Ok(markdown_error_output(
            input.filename,
            &source_path,
            &output_path,
            &output_filename,
            document_parse_error("resource_limit", "文档超过本地 100 MB 安全解析上限。"),
        ));
    }
    let bytes = general_purpose::STANDARD
        .decode(payload)
        .map_err(|e| format!("文档数据解码失败: {}", e))?;
    if bytes.len() > MAX_DOCUMENT_BYTES {
        return Ok(markdown_error_output(
            input.filename,
            &source_path,
            &output_path,
            &output_filename,
            document_parse_error("resource_limit", "文档超过本地 100 MB 安全解析上限。"),
        ));
    }
    std::fs::write(&source_path, &bytes).map_err(|e| format!("缓存待转换文档失败: {}", e))?;

    match convert_source_to_markdown(&source_path, &markdown_output_path, max_chars).await {
        Ok(conversion) => finalize_markdown_conversion_output(
            input.filename,
            &source_path,
            &markdown_output_path,
            &output_path,
            &output_filename,
            &output_format,
            conversion,
            max_chars,
        )
        .map_err(|err| err),
        Err(err) => Ok(markdown_error_output(
            input.filename,
            &source_path,
            &output_path,
            &output_filename,
            err,
        )),
    }
}

#[tauri::command]
pub async fn document_path_to_markdown_file(
    app: tauri::AppHandle,
    input: DocumentPathToMarkdownInput,
) -> Result<DocumentToMarkdownFileOutput, String> {
    let source_path = PathBuf::from(input.source_path.trim());
    if !source_path.exists() || !source_path.is_file() {
        return Err("源文件不存在或不是有效文件。".into());
    }

    let source_name = source_path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("document")
        .to_string();
    let output_dir = input
        .output_dir
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .map(PathBuf::from)
        .or_else(|| source_path.parent().map(|path| path.to_path_buf()))
        .ok_or_else(|| "无法确定输出目录。".to_string())?;
    let (source_path, output_dir) = validate_document_project_paths(&source_path, &output_dir)?;
    let output_format = normalize_output_format(input.output_format.as_deref());
    let output_filename = converted_output_filename(&source_name, &output_format);
    let output_path = available_output_path(&output_dir, &output_filename);
    let markdown_output_filename = markdown_output_filename(&source_name);
    let markdown_output_path = if output_format == "md" {
        output_path.clone()
    } else {
        let cache_dir = app_media_dir(&app, "document-markdown-outputs")?;
        cache_dir.join(unique_media_filename(&markdown_output_filename))
    };
    let max_chars = input.max_chars.unwrap_or(500_000);

    if std::fs::metadata(&source_path)
        .map_err(|_| "源文件不可访问。".to_string())?
        .len()
        > MAX_DOCUMENT_BYTES as u64
    {
        return Ok(markdown_error_output(
            source_name.clone(),
            &source_path,
            &output_path,
            &output_filename,
            document_parse_error("resource_limit", "文档超过本地 100 MB 安全解析上限。"),
        ));
    }

    match convert_source_to_markdown(&source_path, &markdown_output_path, max_chars).await {
        Ok(conversion) => finalize_markdown_conversion_output(
            source_name,
            &source_path,
            &markdown_output_path,
            &output_path,
            &output_filename,
            &output_format,
            conversion,
            max_chars,
        )
        .map_err(|err| err),
        Err(err) => Ok(markdown_error_output(
            source_name,
            &source_path,
            &output_path,
            &output_filename,
            err,
        )),
    }
}

#[tauri::command]
pub async fn media_select_file(
    app: tauri::AppHandle,
    jobs: State<'_, MediaCaptureJobs>,
    input: MediaSelectFileInput,
) -> Result<Option<MediaInspectFileOutput>, String> {
    let selected = app
        .dialog()
        .file()
        .set_title(input.title.unwrap_or_else(|| "选择音频或视频".into()))
        .add_filter(
            "音频视频",
            &[
                "mp4", "mov", "mkv", "webm", "mp3", "wav", "aac", "m4a", "flac", "ogg",
            ],
        )
        .blocking_pick_file();
    let Some(selected) = selected else {
        return Ok(None);
    };
    let path = selected
        .as_path()
        .ok_or_else(|| "请选择有效的音频或视频文件。".to_string())?;
    let source = jobs.allow_input(path).await?;
    inspect_media_path(&app, &source).await.map(Some)
}

#[tauri::command]
pub async fn media_inspect_file(
    app: tauri::AppHandle,
    jobs: State<'_, MediaCaptureJobs>,
    input: MediaInspectFileInput,
) -> Result<MediaInspectFileOutput, String> {
    let source = resolve_media_input_path(&app, &jobs, &input.input_path).await?;
    inspect_media_path(&app, &source).await
}

#[tauri::command]
pub async fn media_process_file(
    app: tauri::AppHandle,
    jobs: State<'_, MediaCaptureJobs>,
    input: MediaProcessFileInput,
) -> Result<MediaProcessFileOutput, String> {
    let source = resolve_media_input_path(&app, &jobs, &input.input_path).await?;
    let output_dir = app_media_dir(&app, "media-outputs")?;
    let output_filename = sanitize_media_filename(&input.output_filename, "media-output.mp4");
    let output_path = output_dir.join(unique_media_filename(&output_filename));
    let args = build_ffmpeg_args(&input, &source, &output_path)?;
    let start = Instant::now();

    let output = timeout(
        Duration::from_secs(900),
        Command::new(resolve_app_media_binary(&app, "ffmpeg")?)
            .args(args)
            .kill_on_drop(true)
            .output(),
    )
    .await
    .map_err(|_| "媒体处理超时，请稍后重试。".to_string())?
    .map_err(|_| "媒体处理组件暂时不可用，请重启应用后重试。".to_string())?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    if !output.status.success() {
        let detail = stderr.trim();
        if detail.is_empty() {
            return Err("媒体处理失败，请检查文件后重试。".into());
        }
        return Err(format!(
            "媒体处理失败：{}",
            sanitize_media_process_error(detail, "请检查文件后重试。")
        ));
    }

    let output_size = std::fs::metadata(&output_path)
        .map_err(|e| format!("读取输出文件失败: {}", e))?
        .len();
    jobs.allow_output(&output_path).await?;
    Ok(MediaProcessFileOutput {
        output_path: output_path.to_string_lossy().to_string(),
        output_filename,
        output_size,
        stdout,
        stderr,
        duration_ms: start.elapsed().as_millis(),
    })
}

#[tauri::command]
pub async fn media_transcribe_file(
    app: tauri::AppHandle,
    jobs: State<'_, MediaCaptureJobs>,
    input: MediaTranscribeFileInput,
) -> Result<MediaTranscribeFileOutput, String> {
    let source = resolve_media_input_path(&app, &jobs, &input.input_path).await?;
    let output_root = app_media_dir(&app, "media-transcripts")?;
    let output_dir = output_root.join(unique_media_filename("transcript-job"));
    std::fs::create_dir_all(&output_dir).map_err(|e| format!("创建转文字目录失败: {}", e))?;
    let format = input
        .output_format
        .as_deref()
        .unwrap_or("txt")
        .trim()
        .trim_start_matches('.')
        .to_ascii_lowercase();
    if !supported_transcript_format(&format) {
        return Err(format!("不支持的转写输出格式: {}", format));
    }
    let model = input.model.unwrap_or_else(|| "base".into());
    let stem = media_file_stem(
        source
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("media"),
    );
    let start = Instant::now();
    let started_at = SystemTime::now();

    let mut command = Command::new({
        resolve_app_media_binary(&app, "whisper-cli")
            .or_else(|_| resolve_app_media_binary(&app, "whisper"))
            .map_err(|_| "媒体处理组件不可用，请重新安装应用后重试。".to_string())?
    });
    command
        .arg(source.to_string_lossy().to_string())
        .arg("--model")
        .arg(model)
        .arg("--output_dir")
        .arg(output_dir.to_string_lossy().to_string())
        .arg("--output_format")
        .arg(format.clone());
    if let Some(language) = input.language {
        if !language.trim().is_empty() {
            command.arg("--language").arg(language);
        }
    }

    let output = timeout(
        Duration::from_secs(1800),
        command.kill_on_drop(true).output(),
    )
    .await
    .map_err(|_| "转文字超时，请稍后重试。".to_string())?
    .map_err(|_| "媒体处理组件暂时不可用，请重启应用后重试。".to_string())?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    if !output.status.success() {
        let detail = stderr.trim();
        if detail.is_empty() {
            return Err("转文字失败，请检查文件后重试。".into());
        }
        return Err(format!(
            "转文字失败：{}",
            sanitize_media_process_error(detail, "请检查文件后重试。")
        ));
    }

    let output_path = find_transcript_output(&output_dir, &stem, &format, started_at)
        .ok_or_else(|| "转文字完成后没有找到输出文件。".to_string())?;
    let output_size = std::fs::metadata(&output_path)
        .map_err(|e| format!("读取转写文件失败: {}", e))?
        .len();
    let text = std::fs::read_to_string(&output_path).unwrap_or_default();
    let output_filename = output_path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("transcript.txt")
        .to_string();

    jobs.allow_output(&output_path).await?;
    Ok(MediaTranscribeFileOutput {
        output_path: output_path.to_string_lossy().to_string(),
        output_filename,
        output_size,
        text,
        stdout,
        stderr,
        duration_ms: start.elapsed().as_millis(),
    })
}

#[tauri::command]
pub async fn media_burn_subtitles(
    app: tauri::AppHandle,
    jobs: State<'_, MediaCaptureJobs>,
    input: MediaBurnSubtitlesInput,
) -> Result<MediaProcessFileOutput, String> {
    let source = resolve_media_input_path(&app, &jobs, &input.input_path).await?;
    let subtitle_text = input.subtitle_text.trim();
    if subtitle_text.is_empty() {
        return Err("字幕文本不能为空".into());
    }
    let subtitle_dir = app_media_dir(&app, "media-subtitles")?;
    let subtitle_path = subtitle_dir.join(unique_media_filename("subtitle.srt"));
    std::fs::write(&subtitle_path, subtitle_text.as_bytes())
        .map_err(|e| format!("写入字幕文件失败: {}", e))?;

    let output_dir = app_media_dir(&app, "media-outputs")?;
    let fallback = format!(
        "{}_subtitled.mp4",
        media_file_stem(
            source
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("video")
        )
    );
    let output_filename = sanitize_media_filename(
        input.output_filename.as_deref().unwrap_or(&fallback),
        &fallback,
    );
    let output_path = output_dir.join(unique_media_filename(&output_filename));
    let filter = format!(
        "subtitles=filename='{}'",
        escape_subtitle_filter_path(&subtitle_path)
    );
    let start = Instant::now();

    let output = timeout(
        Duration::from_secs(900),
        Command::new(resolve_app_media_binary(&app, "ffmpeg")?)
            .args([
                "-y",
                "-hide_banner",
                "-i",
                &source.to_string_lossy(),
                "-vf",
                &filter,
                "-c:v",
                "libx264",
                "-c:a",
                "copy",
                &output_path.to_string_lossy(),
            ])
            .kill_on_drop(true)
            .output(),
    )
    .await
    .map_err(|_| "视频上字幕超时，请稍后重试。".to_string())?
    .map_err(|_| "媒体处理组件暂时不可用，请重启应用后重试。".to_string())?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    if !output.status.success() {
        let detail = stderr.trim();
        if detail.is_empty() {
            return Err("视频上字幕失败，请检查字幕文件后重试。".into());
        }
        return Err(format!(
            "视频上字幕失败：{}",
            sanitize_media_process_error(detail, "请检查字幕文件后重试。")
        ));
    }
    let output_size = std::fs::metadata(&output_path)
        .map_err(|e| format!("读取输出文件失败: {}", e))?
        .len();
    jobs.allow_output(&output_path).await?;
    Ok(MediaProcessFileOutput {
        output_path: output_path.to_string_lossy().to_string(),
        output_filename,
        output_size,
        stdout,
        stderr,
        duration_ms: start.elapsed().as_millis(),
    })
}

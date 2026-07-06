use base64::{engine::general_purpose, Engine as _};
use std::env;
use std::path::{Component, Path, PathBuf};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{Emitter, Manager, State};
use tokio::process::Command;
use tokio::time::timeout;
use tauri_plugin_dialog::DialogExt;
use crate::commands::tools::{resolve_local_binary, resolve_app_media_binary, resolve_local_python, local_tools_python_path};
use crate::*;

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
    data.split_once(',').map(|(_, payload)| payload).unwrap_or(data)
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

pub fn has_meaningful_text_outside_conversion_markers(content: &str) -> bool {
    let mut cleaned = String::with_capacity(content.len());
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if trimmed.starts_with("<!--") && trimmed.ends_with("-->") {
            continue;
        }
        if trimmed.starts_with('#') {
            continue;
        }
        if trimmed.starts_with("- 来源文件：")
            || trimmed.starts_with("- 总页数：")
            || trimmed.starts_with("- 已处理页数：")
            || trimmed.starts_with("- OCR 失败页数：")
            || trimmed.starts_with("- 状态：")
        {
            continue;
        }
        if trimmed.starts_with("- 第 ")
            && (trimmed.contains("RapidOCR")
                || trimmed.contains("OCR")
                || trimmed.contains("没有识别到有效正文"))
        {
            continue;
        }
        if trimmed.starts_with('>')
            && (trimmed.contains("本页 OCR 未成功")
                || trimmed.contains("本页未识别到文字")
                || trimmed.contains("OCR 识别失败")
                || trimmed.contains("来源："))
        {
            continue;
        }
        for ch in trimmed.chars() {
            if ch.is_alphanumeric() {
                cleaned.push(ch);
            }
        }
    }
    cleaned.chars().count() >= 2
}

pub fn is_internal_conversion_failure_markdown(_content: &str) -> bool {
    false
}

#[cfg_attr(not(test), allow(dead_code))]
pub fn is_successful_markdown_content(content: &str) -> bool {
    is_meaningful_markdown(content) && !is_internal_conversion_failure_markdown(content)
}


pub fn truncate_markdown(content: String, max_chars: usize) -> (String, bool) {
    let max = max_chars.clamp(1, 1_000_000);
    if content.chars().count() <= max {
        return (content, false);
    }
    (content.chars().take(max).collect(), true)
}

pub fn loose_cache_key(value: &str) -> String {
    value
        .chars()
        .filter(|ch| ch.is_alphanumeric())
        .flat_map(|ch| ch.to_lowercase())
        .collect()
}

pub async fn count_pdf_pages(source: &Path) -> Option<usize> {
    if source.extension().and_then(|value| value.to_str()).map(|value| value.eq_ignore_ascii_case("pdf")) != Some(true) {
        return None;
    }
    let mut command = Command::new(resolve_local_python());
    if let Some(python_path) = local_tools_python_path() {
        command.env("PYTHONPATH", python_path.to_string_lossy().to_string());
    }
    command
        .env("PYTHONNOUSERSITE", "1")
        .env_remove("PYTHONHOME")
        .current_dir(env::temp_dir())
        .arg("-c")
        .arg(r#"
import sys

source = sys.argv[1]

try:
    from pypdf import PdfReader
    print(len(PdfReader(source).pages))
    sys.exit(0)
except Exception:
    pass

try:
    import pypdfium2 as pdfium
    print(len(pdfium.PdfDocument(source)))
    sys.exit(0)
except Exception:
    sys.exit(1)
"#)
        .arg(source)
        .kill_on_drop(true);
    let output = match timeout(Duration::from_secs(10), command.output()).await {
        Ok(Ok(output)) => output,
        _ => return None,
    };
    if !output.status.success() {
        return None;
    }
    String::from_utf8_lossy(&output.stdout).trim().parse::<usize>().ok()
}

#[derive(Debug, Clone, Copy)]
struct PdfTextProbe {
    page_count: usize,
    sampled_pages: usize,
    text_pages: usize,
    text_chars: usize,
}

pub async fn probe_pdf_text_layer(source: &Path) -> Option<PdfTextProbe> {
    if !is_pdf_path(source) {
        return None;
    }

    let mut command = python_command_with_local_tools();
    command
        .arg("-c")
        .arg(r#"
import json
import re
import sys

source = sys.argv[1]

try:
    from pypdf import PdfReader
    reader = PdfReader(source)
    total = len(reader.pages)
    if total <= 0:
        print(json.dumps({"page_count": 0, "sampled_pages": 0, "text_pages": 0, "text_chars": 0}))
        sys.exit(0)

    sample_count = min(total, 12)
    if sample_count == 1:
        indices = [0]
    else:
        indices = sorted(set(round(i * (total - 1) / (sample_count - 1)) for i in range(sample_count)))

    text_pages = 0
    text_chars = 0
    for index in indices:
        try:
            text = reader.pages[index].extract_text() or ""
        except Exception:
            text = ""
        cleaned = re.sub(r"\s+", "", text)
        count = len(cleaned)
        text_chars += count
        if count >= 80:
            text_pages += 1

    print(json.dumps({
        "page_count": total,
        "sampled_pages": len(indices),
        "text_pages": text_pages,
        "text_chars": text_chars,
    }, ensure_ascii=False))
except Exception:
    sys.exit(1)
"#)
        .arg(source)
        .kill_on_drop(true);

    let output = match timeout(Duration::from_secs(20), command.output()).await {
        Ok(Ok(output)) if output.status.success() => output,
        _ => return None,
    };
    let value: serde_json::Value = serde_json::from_slice(&output.stdout).ok()?;
    Some(PdfTextProbe {
        page_count: value.get("page_count")?.as_u64()? as usize,
        sampled_pages: value.get("sampled_pages")?.as_u64()? as usize,
        text_pages: value.get("text_pages")?.as_u64()? as usize,
        text_chars: value.get("text_chars")?.as_u64()? as usize,
    })
}

pub fn pdf_probe_has_text_layer(probe: &PdfTextProbe) -> bool {
    if probe.page_count == 0 || probe.sampled_pages == 0 {
        return false;
    }
    let enough_pages = probe.text_pages >= 2 || probe.text_pages * 2 >= probe.sampled_pages;
    let enough_chars = probe.text_chars >= 400 || probe.text_chars >= probe.sampled_pages * 120;
    enough_pages && enough_chars
}

pub fn is_meaningful_markitdown_output(content: &str, source: &Path, pdf_probe: Option<&PdfTextProbe>) -> bool {
    if !is_successful_markdown_content(content) {
        return false;
    }
    if !is_pdf_path(source) {
        return true;
    }
    let page_count = pdf_probe.map(|probe| probe.page_count).unwrap_or(1).max(1);
    let text_chars = meaningful_text_char_count(content);
    let min_chars = if page_count >= 30 {
        1_000
    } else if page_count >= 10 {
        350
    } else {
        20
    };
    text_chars >= min_chars
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

pub fn is_pdf_path(source: &Path) -> bool {
    source
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.eq_ignore_ascii_case("pdf"))
        .unwrap_or(false)
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

pub fn source_cache_key(source: &Path) -> String {
    let stem = source
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("document");
    let metadata = std::fs::metadata(source).ok();
    let len = metadata.as_ref().map(|value| value.len()).unwrap_or(0);
    let modified = metadata
        .and_then(|value| value.modified().ok())
        .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
        .map(|value| value.as_secs())
        .unwrap_or(0);
    format!("{}_{}_{}", loose_cache_key(stem), len, modified)
}

pub fn chunk_markdown_cache_path(cache_dir: &Path, source: &Path, start_page: usize, end_page: usize) -> PathBuf {
    cache_dir
        .join("document-markdown-chunks")
        .join(source_cache_key(source))
        .join(format!("p{:04}-p{:04}.md", start_page, end_page))
}

pub fn read_meaningful_cached_chunk(path: &Path) -> Option<String> {
    let content = std::fs::read_to_string(path).ok()?;
    if content.contains("本页 OCR 未成功")
        || content.contains("本页未识别到文字")
        || content.contains("OCR 失败")
        || content.contains("RapidOCR 本地引擎不可用")
    {
        return None;
    }
    if is_successful_markdown_content(&content) {
        Some(content)
    } else {
        None
    }
}

pub fn write_text_file(path: &Path, content: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建输出目录失败: {}", e))?;
    }
    std::fs::write(path, content).map_err(|e| format!("写入文件失败: {}", e))
}

pub fn emit_format_progress(
    app: &tauri::AppHandle,
    job_id: Option<&str>,
    source: &Path,
    completed_pages: usize,
    total_pages: usize,
    message: String,
) {
    let progress = if total_pages == 0 {
        0
    } else {
        ((completed_pages as f64 / total_pages as f64) * 100.0).round().clamp(0.0, 100.0) as u8
    };
    let _ = app.emit("format-converter-progress", FormatConverterProgress {
        job_id: job_id.map(|value| value.to_string()),
        source_path: source.to_string_lossy().to_string(),
        completed_pages,
        total_pages,
        progress,
        message,
    });
}

pub fn placeholder_page_markdown(source_name: &str, page: usize, error: &str) -> String {
    [
        format!("<!-- source-page: {} -->", page),
        format!("## 第 {} 页", page),
        String::new(),
        format!("> 本页 OCR 未成功，已保留占位。原因：{}", error),
        String::new(),
        format!("> 来源：{}", source_name),
        String::new(),
    ].join("\n")
}







pub async fn run_markitdown(source: &Path, output_path: &Path) -> Result<(String, String, String), String> {
    let output = timeout(
        Duration::from_secs(90),
        Command::new(resolve_local_binary("markitdown"))
            .arg(source)
            .arg("-o")
            .arg(output_path)
            .kill_on_drop(true)
            .output(),
    )
    .await
    .map_err(|_| "MarkItDown 执行超时（90 秒），请先转成 Markdown/TXT 后再导入。".to_string())?
    .map_err(|e| format!("未检测到 MarkItDown，请先安装：pipx install markitdown 或 pip install markitdown。启动失败: {}", e))?;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    if !output.status.success() {
        return Err(format!("MarkItDown 转换失败: {}", stderr.trim()));
    }
    let content = std::fs::read_to_string(output_path)
        .map_err(|e| format!("读取 MarkItDown 输出失败: {}", e))?;
    Ok((content, stdout, stderr))
}

pub fn parse_markdown_conversion_mode(value: Option<&str>) -> MarkdownConversionMode {
    match value.unwrap_or("auto").trim().to_ascii_lowercase().as_str() {
        "fast" | "markitdown" => MarkdownConversionMode::Fast,
        "ocr" | "rapidocr" => MarkdownConversionMode::Ocr,
        _ => MarkdownConversionMode::Auto,
    }
}

pub fn normalize_output_format(value: Option<&str>) -> String {
    match value.unwrap_or("md").trim().trim_start_matches('.').to_ascii_lowercase().as_str() {
        "markdown" => "md".into(),
        "md" | "txt" | "html" | "csv" | "json" | "srt" => value.unwrap_or("md").trim().trim_start_matches('.').to_ascii_lowercase(),
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
            let Some(mid) = value[start..].find("](").map(|index| start + index) else { break };
            let Some(end) = value[mid + 2..].find(')').map(|index| mid + 2 + index) else { break };
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
    line.trim()
        .trim_matches('|')
        .split('|')
        .all(|cell| cell.trim().chars().all(|ch| matches!(ch, '-' | ':' | ' ')) && cell.contains('-'))
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
        while cursor < lines.len() && lines[cursor].contains('|') && !lines[cursor].trim().is_empty() {
            rows.push(split_markdown_table_row(lines[cursor]));
            cursor += 1;
        }
        if rows.len() < 2 {
            return None;
        }
        let csv = rows
            .into_iter()
            .map(|row| row.into_iter().map(|cell| csv_escape(&cell)).collect::<Vec<_>>().join(","))
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
        && content.lines().any(|line| line.trim().parse::<usize>().is_ok())
}

pub fn convert_markdown_for_output(output_format: &str, markdown: &str) -> Result<String, String> {
    match output_format {
        "md" => Ok(markdown.trim_end().to_string() + "\n"),
        "txt" => Ok(strip_markdown_for_plain_text(markdown)),
        "html" => Ok(markdown_to_simple_html(markdown)),
        "csv" => {
            let plain = strip_markdown_for_plain_text(markdown);
            if plain.lines().take(5).filter(|line| line.contains(',')).count() >= 2 {
                return Ok(plain);
            }
            markdown_table_to_csv(markdown).ok_or_else(|| "没有检测到可导出 CSV 的表格内容。".into())
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
    if path.components().any(|part| matches!(part, Component::ParentDir)) {
        return Err("文件路径不安全，请重新选择文件。".into());
    }
    let canonical = std::fs::canonicalize(&path).map_err(|_| "文件不可访问，请重新选择。".to_string())?;
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

pub async fn inspect_media_path(app: &tauri::AppHandle, source: &Path) -> Result<MediaInspectFileOutput, String> {
    let metadata = std::fs::metadata(source).map_err(|_| "文件不可访问，请重新选择。".to_string())?;
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

    let data: serde_json::Value = serde_json::from_slice(&output.stdout)
        .map_err(|_| "媒体信息格式不可识别。".to_string())?;
    let streams = data.get("streams").and_then(|value| value.as_array()).cloned().unwrap_or_default();
    let mut width = None;
    let mut height = None;
    let mut fps = None;
    let mut audio_codec = None;
    let mut video_codec = None;
    let mut has_audio = false;
    let mut has_video = false;
    let mut has_subtitles = false;

    for stream in streams {
        let codec_type = stream.get("codec_type").and_then(|value| value.as_str()).unwrap_or("");
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
                    video_codec = stream.get("codec_name").and_then(|value| value.as_str()).map(str::to_string);
                }
            }
            "audio" => {
                has_audio = true;
                if audio_codec.is_none() {
                    audio_codec = stream.get("codec_name").and_then(|value| value.as_str()).map(str::to_string);
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
        .map(|value| value.split(',').next().unwrap_or(value).to_ascii_uppercase())
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

pub fn build_ffmpeg_args(input: &MediaProcessFileInput, source: &Path, output: &Path) -> Result<Vec<String>, String> {
    let action = input.action.trim().to_ascii_lowercase();
    let format = input.target_format.trim().trim_start_matches('.').to_ascii_lowercase();
    if !supported_media_format(&format) {
        return Err(format!("不支持的目标格式: {}", format));
    }

    let source_str = source.to_string_lossy().to_string();
    let output_str = output.to_string_lossy().to_string();
    let mut args = vec![
        "-y".into(),
        "-hide_banner".into(),
        "-i".into(),
        source_str,
    ];

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
                "mp3" | "wav" | "aac" | "flac" | "ogg" => args.extend([
                    "-vn".into(),
                    "-acodec".into(),
                    audio_codec(&format).into(),
                ]),
                _ => args.extend([
                    "-c:v".into(),
                    "libx264".into(),
                    "-c:a".into(),
                    "aac".into(),
                ]),
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
            args.extend([
                "-an".into(),
                "-c:v".into(),
                "copy".into(),
                output_str,
            ]);
        }
        _ => return Err(format!("不支持的媒体处理动作: {}", action)),
    }

    Ok(args)
}

pub fn supported_transcript_format(format: &str) -> bool {
    matches!(format, "txt" | "srt" | "vtt" | "json")
}

pub fn find_transcript_output(output_dir: &Path, stem: &str, format: &str, started_at: SystemTime) -> Option<PathBuf> {
    let direct = output_dir.join(format!("{}.{}", stem, format));
    if direct.exists()
        && std::fs::metadata(&direct)
            .ok()
            .and_then(|metadata| metadata.modified().ok())
            .is_some_and(|modified| modified >= started_at.checked_sub(Duration::from_secs(5)).unwrap_or(started_at))
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
            if modified < started_at.checked_sub(Duration::from_secs(5)).unwrap_or(started_at) {
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
pub fn media_cache_file(app: tauri::AppHandle, input: MediaCacheFileInput) -> Result<MediaCacheFileOutput, String> {
    let cache_dir = app_media_dir(&app, "media-cache")?;
    let filename = unique_media_filename(&input.filename);
    let path = cache_dir.join(&filename);
    let payload = strip_data_url_prefix(input.data_base64.trim());
    let bytes = general_purpose::STANDARD
        .decode(payload)
        .map_err(|e| format!("媒体文件解码失败: {}", e))?;
    std::fs::write(&path, &bytes).map_err(|e| format!("缓存媒体文件失败: {}", e))?;
    let size = std::fs::metadata(&path).map_err(|e| format!("读取媒体缓存失败: {}", e))?.len();
    Ok(MediaCacheFileOutput {
        input_path: path.to_string_lossy().to_string(),
        filename,
        size,
    })
}

pub async fn convert_pdf_to_markdown(
    app: &tauri::AppHandle,
    _jobs: &ConversionJobs,
    job_id: Option<&str>,
    source_path: &Path,
    output_path: &Path,
    max_chars: usize,
    mode: MarkdownConversionMode,
    _timeout_seconds: Option<u64>,
) -> Result<MarkdownConversion, String> {
    if mode == MarkdownConversionMode::Ocr {
        return Err("OCR 模式已移除。请使用快速模式，或安装第三方 OCR 工具后通过 OpenCode 处理。".into());
    }

    emit_format_progress(app, job_id, source_path, 0, 0, "正在判断文档类型".into());
    let probe = probe_pdf_text_layer(source_path).await;
    let mut markitdown_error: Option<String> = None;
    let mut markitdown_attempted = false;

    if mode == MarkdownConversionMode::Fast || probe.as_ref().map(pdf_probe_has_text_layer).unwrap_or(false) {
        markitdown_attempted = true;
        let message = if mode == MarkdownConversionMode::Fast {
            "快速转换中"
        } else {
            "检测到文字层，快速转换中"
        };
        emit_format_progress(app, job_id, source_path, 0, 0, message.into());
        match run_markitdown(source_path, output_path).await {
            Ok((content, _stdout, _stderr)) => {
                if is_meaningful_markitdown_output(&content, source_path, probe.as_ref()) {
                    let (content, truncated) = truncate_markdown(content, max_chars);
                    return Ok(MarkdownConversion {
                        content,
                        engine: "markitdown".into(),
                        truncated,
                        message: "已使用本地快速转换生成 Markdown。".into(),
                    });
                }
                let _ = std::fs::remove_file(output_path);
                markitdown_error = Some("PDF 文字层不完整，本地快速转换没有得到足够正文。".into());
            }
            Err(err) => {
                let _ = std::fs::remove_file(output_path);
                markitdown_error = Some(err);
            }
        }
    }

    if mode == MarkdownConversionMode::Fast {
        return Err(markitdown_error.unwrap_or_else(|| "快速模式没有提取到有效正文，请切换 OCR 模式。".into()));
    }

    let page_count = match probe.map(|value| value.page_count).filter(|value| *value > 0) {
        Some(value) => Some(value),
        None => count_pdf_pages(source_path).await,
    };

    if let Some(page_count) = page_count {
        emit_format_progress(app, job_id, source_path, 0, page_count, "未检测到有效文字层，进入分段 OCR".into());
        return Err("OCR 已移除。请使用快速模式。".into());
    }

    if !markitdown_attempted {
        match run_markitdown(source_path, output_path).await {
            Ok((content, _stdout, _stderr)) => {
                if is_meaningful_markitdown_output(&content, source_path, probe.as_ref()) {
                    let (content, truncated) = truncate_markdown(content, max_chars);
                    return Ok(MarkdownConversion {
                        content,
                        engine: "markitdown".into(),
                        truncated,
                        message: "已使用本地快速转换生成 Markdown。".into(),
                    });
                }
                let _ = std::fs::remove_file(output_path);
                markitdown_error = Some("PDF 页数读取失败，且本地快速转换没有得到有效正文。".into());
            }
            Err(err) => {
                let _ = std::fs::remove_file(output_path);
                markitdown_error = Some(err);
            }
        }
    }

    Err(markitdown_error.unwrap_or_else(|| "PDF 页数读取失败，无法执行分段 OCR。".into()))
}

pub async fn convert_source_to_markdown(
    app: &tauri::AppHandle,
    jobs: &ConversionJobs,
    job_id: Option<&str>,
    source_path: &Path,
    output_path: &Path,
    max_chars: usize,
    mode: MarkdownConversionMode,
    timeout_seconds: Option<u64>,
) -> Result<MarkdownConversion, String> {
    if is_pdf_path(source_path) {
        return convert_pdf_to_markdown(app, jobs, job_id, source_path, output_path, max_chars, mode, timeout_seconds).await;
    }

    if is_image_path(source_path) {
        return Err("图片 OCR 已移除。请安装第三方 OCR 工具后通过 OpenCode 处理。".into());
    }

    if mode == MarkdownConversionMode::Ocr {
        return Err("OCR 模式已移除。请使用快速模式。".into());
    }

    match run_markitdown(source_path, output_path).await {
        Ok((content, _stdout, _stderr)) => {
            if is_meaningful_markitdown_output(&content, source_path, None) {
                let (content, truncated) = truncate_markdown(content, max_chars);
                Ok(MarkdownConversion {
                    content,
                    engine: "markitdown".into(),
                    truncated,
                    message: "已使用本地快速转换生成 Markdown。".into(),
                })
            } else {
                let _ = std::fs::remove_file(output_path);
                Err("本地快速转换没有提取到有效正文。".into())
            }
        }
        Err(err) => {
            let _ = std::fs::remove_file(output_path);
            Err(err)
        }
    }
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
    }
}

pub fn markdown_error_output(
    source: String,
    source_path: &Path,
    output_path: &Path,
    fallback_filename: &str,
    message: String,
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
        message: message.clone(),
        error: Some(message),
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

    let markdown = std::fs::read_to_string(markdown_path)
        .unwrap_or_else(|_| conversion.content.clone());
    let output_content = convert_markdown_for_output(output_format, &markdown)?;
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
    jobs: State<'_, ConversionJobs>,
    input: DocumentToMarkdownFileInput,
) -> Result<DocumentToMarkdownFileOutput, String> {
    let job_id = input
        .job_id
        .clone()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
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
    let max_chars = input.max_chars.unwrap_or(500_000);
    let mode = parse_markdown_conversion_mode(input.conversion_mode.as_deref());
    let timeout_seconds = input.timeout_seconds;

    let payload = strip_data_url_prefix(input.data_base64.trim());
    let bytes = general_purpose::STANDARD
        .decode(payload)
        .map_err(|e| format!("文档数据解码失败: {}", e))?;
    std::fs::write(&source_path, &bytes).map_err(|e| format!("缓存待转换文档失败: {}", e))?;

    let result = match convert_source_to_markdown(&app, &jobs, job_id.as_deref(), &source_path, &markdown_output_path, max_chars, mode, timeout_seconds).await {
        Ok(conversion) => finalize_markdown_conversion_output(
            input.filename,
            &source_path,
            &markdown_output_path,
            &output_path,
            &output_filename,
            &output_format,
            conversion,
            max_chars,
        ).map_err(|err| err),
        Err(err) => Ok(markdown_error_output(
            input.filename,
            &source_path,
            &output_path,
            &output_filename,
            err,
        )),
    };
    jobs.finish_job(job_id.as_deref()).await;
    result
}

#[tauri::command]
pub async fn document_path_to_markdown_file(
    app: tauri::AppHandle,
    jobs: State<'_, ConversionJobs>,
    input: DocumentPathToMarkdownInput,
) -> Result<DocumentToMarkdownFileOutput, String> {
    let job_id = input
        .job_id
        .clone()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
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
    std::fs::create_dir_all(&output_dir).map_err(|e| format!("创建输出目录失败: {}", e))?;
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
    let mode = parse_markdown_conversion_mode(input.conversion_mode.as_deref());
    let timeout_seconds = input.timeout_seconds;

    let result = match convert_source_to_markdown(&app, &jobs, job_id.as_deref(), &source_path, &markdown_output_path, max_chars, mode, timeout_seconds).await {
        Ok(conversion) => finalize_markdown_conversion_output(
            source_name,
            &source_path,
            &markdown_output_path,
            &output_path,
            &output_filename,
            &output_format,
            conversion,
            max_chars,
        ).map_err(|err| err),
        Err(err) => Ok(markdown_error_output(
            source_name,
            &source_path,
            &output_path,
            &output_filename,
            err,
        )),
    };
    jobs.finish_job(job_id.as_deref()).await;
    result
}

#[tauri::command]
pub async fn cancel_markdown_conversion(
    jobs: State<'_, ConversionJobs>,
    input: CancelMarkdownConversionInput,
) -> Result<(), String> {
    let job_id = input.job_id.trim();
    if !job_id.is_empty() {
        jobs.cancel_job(job_id).await;
    }
    Ok(())
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
        .add_filter("音频视频", &["mp4", "mov", "mkv", "webm", "mp3", "wav", "aac", "m4a", "flac", "ogg"])
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
        Command::new(resolve_app_media_binary(&app, "ffmpeg")?).args(args).kill_on_drop(true).output(),
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

    let output = timeout(Duration::from_secs(1800), command.kill_on_drop(true).output())
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
        media_file_stem(source.file_name().and_then(|value| value.to_str()).unwrap_or("video"))
    );
    let output_filename = sanitize_media_filename(
        input.output_filename.as_deref().unwrap_or(&fallback),
        &fallback,
    );
    let output_path = output_dir.join(unique_media_filename(&output_filename));
    let filter = format!("subtitles=filename='{}'", escape_subtitle_filter_path(&subtitle_path));
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


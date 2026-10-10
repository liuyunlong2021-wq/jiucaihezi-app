use base64::{Engine as _, engine::general_purpose};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
#[cfg(test)]
use futures_util::StreamExt;
#[cfg(test)]
use tokio::io::AsyncWriteExt;
use tauri::ipc::Channel;

#[derive(Deserialize)]
pub struct HttpRequest {
    pub url: String,
    pub method: Option<String>,
    pub headers: Option<HashMap<String, String>>,
    pub body: Option<String>,
    pub body_base64: Option<String>,
    pub timeout_secs: Option<u64>,
}

#[derive(Serialize)]
pub struct HttpResponse {
    pub status: u16,
    pub headers: HashMap<String, String>,
    pub body: String,
    pub body_base64: Option<String>,
}

#[derive(Deserialize)]
pub struct HttpDownloadRequest {
    pub url: String,
    pub headers: Option<HashMap<String, String>>,
    // 下载通道中是连续无数据的等待上限，不是整个文件的耗时上限。
    pub timeout_secs: Option<u64>,
    pub credential_ref: Option<String>,
}

#[derive(Serialize)]
pub struct HttpDownloadResponse {
    pub status: u16,
    pub headers: HashMap<String, String>,
    pub data_base64: String,
}

#[derive(Deserialize)]
pub struct HttpDownloadToProjectRequest {
    pub root: String,
    pub relative_path: String,
    pub url: String,
    pub headers: Option<HashMap<String, String>>,
    pub timeout_secs: Option<u64>,
    pub credential_ref: Option<String>,
}

#[derive(Serialize)]
pub struct HttpDownloadToProjectResponse {
    pub status: u16,
    pub headers: HashMap<String, String>,
    pub bytes_written: u64,
    pub relative_path: String,
}

#[derive(Deserialize)]
pub struct DocumentMarkdownRequest {
    pub url: String,
    pub api_key: String,
    pub filename: String,
    pub mime_type: String,
    pub data_base64: String,
    pub max_chars: usize,
}

#[derive(Deserialize)]
pub struct ComfyUploadImageRequest {
    pub url: String,
    pub headers: Option<HashMap<String, String>>,
    pub filename: String,
    pub mime_type: String,
    pub data_base64: String,
}

fn is_unified_api_host(url: &str) -> bool {
    tauri::Url::parse(url)
        .ok()
        .and_then(|parsed| {
            parsed
                .host_str()
                .map(|host| host == "api.jiucaihezi.studio")
        })
        .unwrap_or(false)
}

fn is_document_converter_url(url: &str) -> bool {
    tauri::Url::parse(url).ok().is_some_and(|parsed| {
        parsed.scheme() == "https"
            && parsed.host_str() == Some("api.jiucaihezi.studio")
            && parsed.path() == "/documents/markdown"
            && parsed.query().is_none()
    })
}

fn is_local_comfy_upload_url(url: &str) -> bool {
    tauri::Url::parse(url).ok().is_some_and(|parsed| {
        let local = parsed.host_str().is_some_and(|host| {
            host == "localhost" || host.trim_matches(['[', ']']).parse::<std::net::IpAddr>().is_ok_and(|ip| match ip {
                std::net::IpAddr::V4(ip) => ip.is_loopback() || ip.is_private(),
                std::net::IpAddr::V6(ip) => ip.is_loopback(),
            })
        });
        (parsed.scheme() == "https" || (parsed.scheme() == "http" && local))
            && parsed.username().is_empty() && parsed.password().is_none()
            && parsed.path().ends_with("/upload/image") && parsed.query().is_none() && parsed.fragment().is_none()
    })
}

fn is_newapi_passthrough_path(url: &str) -> bool {
    tauri::Url::parse(url)
        .ok()
        .map(|parsed| {
            parsed.path().starts_with("/v1/")
                || parsed.path() == "/api/creations/upload-url"
        })
        .unwrap_or(false)
}

fn has_gateway_session_header(headers: &Option<HashMap<String, String>>) -> bool {
    headers.as_ref().is_some_and(|headers| {
        headers
            .keys()
            .any(|key| key.eq_ignore_ascii_case("x-jc-session"))
    })
}

pub(crate) fn should_direct_unified_api_to_newapi(request: &HttpRequest) -> bool {
    is_unified_api_host(&request.url)
        && is_newapi_passthrough_path(&request.url)
        && !has_gateway_session_header(&request.headers)
}

fn with_newapi_source_resolution(
    mut client_builder: reqwest::ClientBuilder,
) -> reqwest::ClientBuilder {
    client_builder = client_builder.resolve(
        "api.jiucaihezi.studio",
        std::net::SocketAddr::new(
            std::net::IpAddr::V4(std::net::Ipv4Addr::new(47, 82, 86, 196)),
            443,
        ),
    );
    client_builder
}

#[derive(Default)]
pub(crate) struct Utf8StreamDecoder {
    pending: Vec<u8>,
}

impl Utf8StreamDecoder {
    pub(crate) fn push(&mut self, bytes: &[u8]) -> String {
        if bytes.is_empty() {
            return String::new();
        }

        self.pending.extend_from_slice(bytes);
        match std::str::from_utf8(&self.pending) {
            Ok(text) => {
                let output = text.to_string();
                self.pending.clear();
                output
            }
            Err(err) => {
                let valid_up_to = err.valid_up_to();
                if valid_up_to == 0 {
                    return String::new();
                }
                let output = String::from_utf8_lossy(&self.pending[..valid_up_to]).to_string();
                self.pending.drain(..valid_up_to);
                output
            }
        }
    }

    pub(crate) fn finish(&mut self) -> String {
        if self.pending.is_empty() {
            return String::new();
        }
        let output = String::from_utf8_lossy(&self.pending).to_string();
        self.pending.clear();
        output
    }
}

fn stream_error_message(status: u16, headers: &HashMap<String, String>, detail: &str) -> String {
    let header = |name: &str| {
        headers
            .iter()
            .find(|(key, _)| key.eq_ignore_ascii_case(name))
            .map(|(_, value)| value.as_str())
            .unwrap_or("none")
    };
    let request_id = ["x-oneapi-request-id", "x-request-id", "cf-ray"]
        .iter()
        .find_map(|name| {
            headers
                .iter()
                .find(|(key, _)| key.eq_ignore_ascii_case(name))
                .map(|(_, value)| value.as_str())
        })
        .unwrap_or("none");

    format!(
        "读取流失败: {} (HTTP {}, content-encoding: {}, request-id: {})",
        detail,
        status,
        header("content-encoding"),
        request_id,
    )
}

fn is_binary_content_type(value: Option<&str>) -> bool {
    let content_type = value.unwrap_or_default().to_ascii_lowercase();
    content_type.starts_with("audio/")
        || content_type.starts_with("video/")
        || content_type.starts_with("image/")
        || content_type == "binary/octet-stream"
        || content_type == "application/octet-stream"
}

#[tauri::command]
pub async fn http_request(request: HttpRequest) -> Result<HttpResponse, String> {
    let mut client_builder = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(10))
        .pool_idle_timeout(std::time::Duration::from_secs(90));
    client_builder = client_builder.timeout(std::time::Duration::from_secs(
        request.timeout_secs.unwrap_or(30),
    ));
    if should_direct_unified_api_to_newapi(&request) {
        client_builder = with_newapi_source_resolution(client_builder);
    }
    let client = client_builder
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;

    let method = match request
        .method
        .as_deref()
        .unwrap_or("GET")
        .to_uppercase()
        .as_str()
    {
        "POST" => reqwest::Method::POST,
        "PUT" => reqwest::Method::PUT,
        "DELETE" => reqwest::Method::DELETE,
        "PATCH" => reqwest::Method::PATCH,
        "HEAD" => reqwest::Method::HEAD,
        "OPTIONS" => reqwest::Method::OPTIONS,
        _ => reqwest::Method::GET,
    };

    let mut req = client.request(method, &request.url);

    if let Some(headers) = &request.headers {
        for (key, value) in headers {
            req = req.header(key.as_str(), value.as_str());
        }
    }

    if let Some(body) = request.body_base64 {
        let bytes = general_purpose::STANDARD
            .decode(body)
            .map_err(|_| "HTTP 二进制请求数据格式无效".to_string())?;
        req = req.body(bytes);
    } else if let Some(body) = request.body {
        req = req.body(body);
    }

    let resp = req
        .send()
        .await
        .map_err(|e| format!("HTTP 请求失败: {}", e))?;

    let status = resp.status().as_u16();
    let mut headers = HashMap::new();
    for (key, value) in resp.headers() {
        if let Ok(v) = value.to_str() {
            headers.insert(key.to_string(), v.to_string());
        }
    }
    let is_binary = is_binary_content_type(headers.get("content-type").map(String::as_str));
    let (body, body_base64) = if is_binary {
        let bytes = resp
            .bytes()
            .await
            .map_err(|e| format!("读取二进制响应失败: {}", e))?;
        (String::new(), Some(general_purpose::STANDARD.encode(bytes)))
    } else {
        let body = resp
            .text()
            .await
            .map_err(|e| format!("读取响应失败: {}", e))?;
        (body, None)
    };

    Ok(HttpResponse {
        status,
        headers,
        body,
        body_base64,
    })
}

#[tauri::command]
pub async fn document_markdown_request(
    request: DocumentMarkdownRequest,
) -> Result<HttpResponse, String> {
    if !is_document_converter_url(&request.url) {
        return Err("文档转换地址不受信任".into());
    }
    let api_key = request.api_key.trim();
    if api_key.is_empty() {
        return Err("请先登录后再上传文档".into());
    }
    let data = general_purpose::STANDARD
        .decode(&request.data_base64)
        .map_err(|_| "文档数据格式无效".to_string())?;
    if data.len() > 20 * 1024 * 1024 {
        return Err("文件超过 20 MB 上限".into());
    }
    let filename = std::path::Path::new(&request.filename)
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .unwrap_or("document")
        .to_string();
    let mime_type = if request.mime_type.trim().is_empty() {
        "application/octet-stream"
    } else {
        request.mime_type.trim()
    };
    let file = reqwest::multipart::Part::bytes(data)
        .file_name(filename)
        .mime_str(mime_type)
        .map_err(|_| "文档 MIME 类型无效".to_string())?;
    let form = reqwest::multipart::Form::new()
        .text(
            "max_chars",
            request.max_chars.clamp(1, 20_000_000).to_string(),
        )
        .part("file", file);
    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(10))
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| format!("创建文档转换连接失败: {}", e))?;
    let response = client
        .post(&request.url)
        .bearer_auth(api_key)
        .header("x-api-key", api_key)
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("文档转换请求失败: {}", e))?;
    let status = response.status().as_u16();
    let headers = response
        .headers()
        .iter()
        .filter_map(|(key, value)| {
            value
                .to_str()
                .ok()
                .map(|value| (key.to_string(), value.to_string()))
        })
        .collect();
    let body = response
        .text()
        .await
        .map_err(|e| format!("读取文档转换结果失败: {}", e))?;
    Ok(HttpResponse {
        status,
        headers,
        body,
        body_base64: None,
    })
}

#[tauri::command]
pub async fn comfy_upload_image(request: ComfyUploadImageRequest) -> Result<HttpResponse, String> {
    if !is_local_comfy_upload_url(&request.url) {
        return Err("ComfyUI 上传地址必须是本机、局域网 HTTP 或 HTTPS 服务的 /upload/image".into());
    }
    let data = general_purpose::STANDARD
        .decode(&request.data_base64)
        .map_err(|_| "参考图数据格式无效".to_string())?;
    if data.len() > 20 * 1024 * 1024 {
        return Err("参考图超过 20 MB 上限".into());
    }
    let filename = std::path::Path::new(&request.filename)
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .unwrap_or("jiucaihezi-reference.png")
        .to_string();
    let file = reqwest::multipart::Part::bytes(data)
        .file_name(filename)
        .mime_str(&request.mime_type)
        .map_err(|_| "参考图 MIME 类型无效".to_string())?;
    let mut upload = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(std::time::Duration::from_secs(10))
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| format!("创建 ComfyUI 上传连接失败: {}", e))?
        .post(&request.url)
        .multipart(reqwest::multipart::Form::new().text("overwrite", "true").part("image", file));
    for (key, value) in request.headers.unwrap_or_default() {
        if key.eq_ignore_ascii_case("authorization") { upload = upload.header(key, value); }
    }
    let response = upload.send()
        .await
        .map_err(|e| format!("ComfyUI 参考图上传失败: {}", e))?;
    let status = response.status().as_u16();
    let body = response
        .text()
        .await
        .map_err(|e| format!("读取 ComfyUI 上传结果失败: {}", e))?;
    Ok(HttpResponse { status, headers: HashMap::new(), body, body_base64: None })
}

#[tauri::command]
pub async fn http_download_base64(
    app: tauri::AppHandle, mut request: HttpDownloadRequest,
) -> Result<HttpDownloadResponse, String> {
    let checked = reqwest::Url::parse(&request.url).map_err(|_| "下载地址无效")?;
    if !matches!(checked.scheme(), "http" | "https") { return Err("下载仅支持 http/https".into()); }
    let target = cached_download_target(&app, &request.url)?;
    tokio::fs::create_dir_all(target.parent().unwrap()).await.map_err(|_| "创建下载缓存目录失败")?;
    let extension = target.extension().and_then(|ext| ext.to_str()).unwrap_or("bin");
    let temp = target.with_extension(format!("{extension}.part"));
    let meta = target.with_extension(format!("{extension}.part.json"));
    for path in [&temp, &meta, &meta.with_extension("json.tmp")] {
        if tokio::fs::symlink_metadata(path).await.is_ok_and(|m| m.file_type().is_symlink()) { return Err("下载缓存路径不能是符号链接".into()); }
    }
    let (sender, cancel) = tokio::sync::watch::channel(false);
    {
        let mut active = DOWNLOADS.get_or_init(Default::default).lock().unwrap();
        if active.contains_key(&target) { return Err("该媒体正在下载，请稍后重试".into()); }
        active.insert(target.clone(), sender);
    }
    let _guard = DownloadGuard(target.clone());
    resolve_download_credential(&request.url, &mut request.headers, request.credential_ref.as_deref())?;
    let (headers, _) = super::media_download::download(&media_download_client(&request)?, &request.url,
        &request.headers.unwrap_or_default(), &temp, &meta, cancel.clone(), |_| {}).await?;
    if *cancel.borrow() { return Err("下载已暂停".into()); }
    validate_download_video(Some(&app), &temp, &target).await?;
    if *cancel.borrow() { return Err("下载已暂停".into()); }
    let bytes = tokio::fs::read(&temp).await.map_err(|_| "读取下载结果失败")?;
    // Compatibility callers still receive Base64; the transfer itself uses the same durable downloader.
    let _ = tokio::fs::remove_file(temp).await;
    let _ = tokio::fs::remove_file(meta).await;
    Ok(HttpDownloadResponse { status: 200, headers, data_base64: general_purpose::STANDARD.encode(bytes) })
}

fn cached_download_target(app: &tauri::AppHandle, url: &str) -> Result<std::path::PathBuf, String> {
    use tauri::Manager;
    let parsed = reqwest::Url::parse(url).map_err(|_| "下载地址无效")?;
    let extension = if parsed.path().ends_with("/content") && parsed.path().starts_with("/v1/videos/") { "mp4" }
        else { parsed.path().rsplit('.').next().filter(|ext| matches!(*ext, "mp4" | "webm" | "mov" | "png" | "jpg" | "mp3" | "wav" | "glb")).unwrap_or("bin") };
    let name = format!("{}.{extension}", super::media_download::identity(url));
    let dir = app.path().app_cache_dir().map_err(|_| "读取下载缓存目录失败")?.join("media-downloads");
    Ok(dir.join(name))
}

fn media_download_client(request: &HttpDownloadRequest) -> Result<reqwest::Client, String> {
    let mut client_builder = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(10))
        .pool_idle_timeout(std::time::Duration::from_secs(90));
    client_builder = client_builder.read_timeout(std::time::Duration::from_secs(
        request.timeout_secs.unwrap_or(60),
    ));
    client_builder
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))
}

pub(crate) fn download_error_detail(error: reqwest::Error) -> String {
    use std::error::Error;
    let error = error.without_url();
    let mut detail = error.to_string();
    let mut source = error.source();
    while let Some(cause) = source {
        detail.push_str(": ");
        detail.push_str(&cause.to_string());
        source = cause.source();
    }
    detail
}

#[cfg(test)]
async fn send_media_download(client: &reqwest::Client, request: &HttpDownloadRequest) -> Result<reqwest::Response, String> {
    // 只补一次下载 GET；鉴权/链接失效直接交给上层，生成 POST 不经过这里。
    for attempt in 0..2 {
        let mut builder = client.get(&request.url);
        if let Some(headers) = &request.headers {
            for (key, value) in headers { builder = builder.header(key, value); }
        }
        match builder.send().await {
            Ok(response) if attempt == 0 && matches!(response.status().as_u16(), 502 | 503 | 504) => {}
            Ok(response) => return Ok(response),
            Err(error) if attempt == 0 && (error.is_connect() || error.is_timeout()) => {}
            Err(error) => return Err(format!("HTTP 下载失败: {}", download_error_detail(error))),
        }
        tokio::time::sleep(std::time::Duration::from_millis(300)).await;
    }
    unreachable!("second attempt returns its result")
}

fn resolve_download_credential(url: &str, headers: &mut Option<HashMap<String, String>>, reference: Option<&str>) -> Result<(), String> {
    if let Some(reference) = reference {
        let allowed = reqwest::Url::parse(url).ok().is_some_and(|url| {
            url.scheme() == "https" && matches!(url.host_str(), Some("api.jiucaihezi.studio" | "tian-shu.net"))
                && ((url.path().starts_with("/v1/videos/") && url.path().ends_with("/content"))
                    || { let parts: Vec<_> = url.path().split('/').collect();
                         parts.len() == 8 && parts[1] == "v1" && parts[2] == "creation" && parts[3] == "tasks" && parts[5] == "outputs" && parts[7] == "content"
                         && [parts[4], parts[6]].iter().all(|part| !part.is_empty() && part.chars().all(|c| c.is_ascii_alphanumeric() || "._:-".contains(c))) })
        });
        if !allowed { return Err("任务密钥不能用于外部下载地址".into()); }
        let key = crate::secure_store::media_download_key(reference)?;
        let headers = headers.get_or_insert_with(HashMap::new);
        headers.retain(|name, _| !name.eq_ignore_ascii_case("authorization") && !name.eq_ignore_ascii_case("x-api-key"));
        headers.insert("Authorization".into(), format!("Bearer {key}"));
    }
    Ok(())
}

static DOWNLOADS: std::sync::OnceLock<std::sync::Mutex<HashMap<std::path::PathBuf, tokio::sync::watch::Sender<bool>>>> = std::sync::OnceLock::new();

struct DownloadGuard(std::path::PathBuf);
impl Drop for DownloadGuard {
    fn drop(&mut self) { DOWNLOADS.get().unwrap().lock().unwrap().remove(&self.0); }
}

#[tauri::command]
pub async fn http_cancel_project_download(app: tauri::AppHandle, root: String, relative_path: String, url: Option<String>) -> Result<(), String> {
    let target = if let Some(url) = url { cached_download_target(&app, &url)? } else {
        let root = crate::commands::dev::canonical_root(&root)?;
        crate::commands::dev::resolve_write_path(&root, &relative_path)?
    };
    if let Some(sender) = DOWNLOADS.get_or_init(Default::default).lock().unwrap().get(&target) { let _ = sender.send(true); }
    Ok(())
}

#[tauri::command]
pub async fn http_download_to_project(
    app: tauri::AppHandle,
    request: HttpDownloadToProjectRequest,
    on_progress: Channel<super::media_download::Progress>,
) -> Result<HttpDownloadToProjectResponse, String> {
    #[cfg(not(any(target_os = "ios", target_os = "android")))]
    let _update_task = super::desktop_update::native_task(&app)?;
    download_to_project(request, Some(app), Some(on_progress)).await
}

async fn validate_download_video(app: Option<&tauri::AppHandle>, path: &std::path::Path, target: &std::path::Path) -> Result<(), String> {
    if !matches!(target.extension().and_then(|ext| ext.to_str()), Some("mp4" | "mov" | "webm")) { return Ok(()); }
    let app = app.ok_or_else(|| "视频校验需要桌面运行时".to_string())?;
    super::media_download::validate_container(path).await?;
    let Ok(probe) = crate::commands::tools::resolve_app_media_binary(app, "ffprobe") else { return Ok(()); };
    let output = tokio::time::timeout(std::time::Duration::from_secs(30), tokio::process::Command::new(probe)
        .args(["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_type", "-of", "csv=p=0"])
        .arg(path).kill_on_drop(true).output()).await.map_err(|_| "视频完整性校验超时")?
        .map_err(|_| "无法启动视频校验组件")?;
    if !output.status.success() || !String::from_utf8_lossy(&output.stdout).contains("video") {
        return Err("下载内容不是可读取的视频，已保留临时文件".into());
    }
    Ok(())
}

async fn download_to_project(
    mut request: HttpDownloadToProjectRequest, app: Option<tauri::AppHandle>,
    on_progress: Option<Channel<super::media_download::Progress>>,
) -> Result<HttpDownloadToProjectResponse, String> {
    crate::commands::skill_material::validate_public_http_url(&request.url)?;
    let root = crate::commands::dev::canonical_root(&request.root)?;
    let target = crate::commands::dev::resolve_write_path(&root, &request.relative_path)?;
    let (sender, cancel) = tokio::sync::watch::channel(false);
    {
        let mut active = DOWNLOADS.get_or_init(Default::default).lock().unwrap();
        if active.contains_key(&target) { return Err("该文件正在下载".into()); }
        active.insert(target.clone(), sender);
    }
    let _guard = DownloadGuard(target.clone());
    let parent = target.parent().ok_or_else(|| "写入路径无效".to_string())?;
    tokio::fs::create_dir_all(parent).await.map_err(|_| "创建媒体目录失败")?;
    if crate::commands::dev::resolve_write_path(&root, &request.relative_path)? != target { return Err("下载目标路径已变化".into()); }
    let name = target.file_name().and_then(|name| name.to_str()).ok_or("媒体文件名无效")?;
    let temp = target.with_file_name(format!(".{name}.part"));
    let meta = target.with_file_name(format!(".{name}.part.json"));
    for path in [&temp, &meta, &meta.with_extension("json.tmp")] {
        if tokio::fs::symlink_metadata(path).await.is_ok_and(|m| m.file_type().is_symlink()) { return Err("下载临时路径不能是符号链接".into()); }
    }
    if target.exists() {
        if !super::media_download::checkpoint_matches(&meta, &request.url, &target).await { return Err("目标文件已存在".into()); }
        validate_download_video(app.as_ref(), &target, &target).await?;
        return Ok(HttpDownloadToProjectResponse { status: 200, headers: HashMap::new(), bytes_written: tokio::fs::metadata(&target).await.map_err(|_| "读取媒体文件失败")?.len(), relative_path: request.relative_path });
    }
    resolve_download_credential(&request.url, &mut request.headers, request.credential_ref.as_deref())?;
    let download_request = HttpDownloadRequest { credential_ref: None, url: request.url.clone(), headers: request.headers.clone(), timeout_secs: Some(request.timeout_secs.unwrap_or(300)) };
    let client = media_download_client(&download_request)?;
    // Throttle IPC so video chunks do not flood the WebView.
    let last = std::sync::Mutex::new(std::time::Instant::now() - std::time::Duration::from_secs(1));
    let (headers, bytes_written) = super::media_download::download(&client, &request.url, &request.headers.unwrap_or_default(), &temp, &meta, cancel.clone(), |progress| {
        let mut time = last.lock().unwrap();
        if time.elapsed() >= std::time::Duration::from_millis(250) || progress.total == Some(progress.bytes) {
            if let Some(channel) = &on_progress { let _ = channel.send(progress); }
            *time = std::time::Instant::now();
        }
    }).await?;
    if *cancel.borrow() { return Err("下载已暂停".into()); }
    validate_download_video(app.as_ref(), &temp, &target).await?;
    if *cancel.borrow() { return Err("下载已暂停".into()); }
    if crate::commands::dev::resolve_write_path(&root, &request.relative_path)? != target { return Err("下载目标路径已变化".into()); }
    if target.exists() { return Err("目标文件已存在，未覆盖".into()); }
    tokio::fs::rename(&temp, &target).await.map_err(|_| "完成媒体文件失败")?;
    Ok(HttpDownloadToProjectResponse { status: 200, headers, bytes_written, relative_path: request.relative_path })
}

#[cfg(test)]
async fn persist_download_response(
    response: reqwest::Response,
    target: &std::path::Path,
    temp: &std::path::Path,
) -> Result<(u16, HashMap<String, String>, u64), String> {
    let status = response.status().as_u16();
    let headers = response.headers().iter().filter_map(|(key, value)| {
        value.to_str().ok().map(|value| (key.to_string(), value.to_string()))
    }).collect::<HashMap<_, _>>();
    if !(200..300).contains(&status) {
        return Err(format!("HTTP 下载失败: {}", status));
    }
    if status == 206 {
        return Err("下载只返回部分文件，未保存".into());
    }
    let extension = target.extension().and_then(|value| value.to_str()).unwrap_or_default().to_ascii_lowercase();
    if matches!(extension.as_str(), "mp4" | "webm" | "mov" | "png" | "jpg" | "jpeg" | "webp" | "gif" | "mp3" | "wav" | "ogg" | "m4a") {
        let content_type = headers.get("content-type").map(|value| value.split(';').next().unwrap_or_default().trim().to_ascii_lowercase()).unwrap_or_default();
        if content_type == "text/html" || content_type == "application/json" || content_type.ends_with("+json") {
            return Err(format!("下载返回了错误页面而非媒体文件: {}", content_type));
        }
    }
    let result = async {
        let mut file = tokio::fs::File::create(temp).await.map_err(|e| format!("创建临时文件失败: {}", e))?;
        let mut stream = response.bytes_stream();
        let mut bytes_written = 0_u64;
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|e| format!("读取下载数据失败: {}", download_error_detail(e)))?;
            file.write_all(&chunk).await.map_err(|e| format!("写入媒体文件失败: {}", e))?;
            bytes_written += chunk.len() as u64;
        }
        if bytes_written == 0 {
            return Err("下载返回空文件，未保存".into());
        }
        file.flush().await.map_err(|e| format!("刷新媒体文件失败: {}", e))?;
        drop(file);
        tokio::fs::rename(temp, target).await.map_err(|e| format!("完成媒体文件失败: {}", e))?;
        Ok::<u64, String>(bytes_written)
    }.await;
    if result.is_err() && tokio::fs::metadata(temp).await.is_ok_and(|m| m.len() == 0) { let _ = tokio::fs::remove_file(temp).await; }
    Ok((status, headers, result?))
}

/// SSE 流式 HTTP 请求 — 通过 Tauri Channel 逐块推送响应
#[tauri::command]
pub async fn http_request_stream(
    request: HttpRequest,
    on_chunk: Channel<serde_json::Value>,
) -> Result<(), String> {
    use futures::StreamExt;

    let mut client_builder = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(10))
        .pool_idle_timeout(std::time::Duration::from_secs(90));
    if let Some(secs) = request.timeout_secs {
        client_builder = client_builder.timeout(std::time::Duration::from_secs(secs));
    }
    if should_direct_unified_api_to_newapi(&request) {
        client_builder = with_newapi_source_resolution(client_builder);
    }
    let client = client_builder
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;

    let method = match request
        .method
        .as_deref()
        .unwrap_or("GET")
        .to_uppercase()
        .as_str()
    {
        "POST" => reqwest::Method::POST,
        "PUT" => reqwest::Method::PUT,
        "DELETE" => reqwest::Method::DELETE,
        "PATCH" => reqwest::Method::PATCH,
        "HEAD" => reqwest::Method::HEAD,
        "OPTIONS" => reqwest::Method::OPTIONS,
        _ => reqwest::Method::GET,
    };

    let mut req = client.request(method, &request.url);

    if let Some(headers) = &request.headers {
        for (key, value) in headers {
            req = req.header(key.as_str(), value.as_str());
        }
    }

    if let Some(body) = request.body {
        req = req.body(body);
    }

    let resp = req
        .send()
        .await
        .map_err(|e| format!("HTTP 请求失败: {}", e))?;

    let status = resp.status().as_u16();
    let mut headers_map = HashMap::new();
    for (key, value) in resp.headers() {
        if let Ok(v) = value.to_str() {
            headers_map.insert(key.to_string(), v.to_string());
        }
    }

    on_chunk
        .send(serde_json::json!({
            "event": "headers",
            "status": status,
            "headers": headers_map,
        }))
        .map_err(|e| format!("推送 headers 失败: {}", e))?;

    let mut stream = resp.bytes_stream();
    let mut utf8_decoder = Utf8StreamDecoder::default();
    while let Some(chunk_result) = stream.next().await {
        match chunk_result {
            Ok(bytes) => {
                let text = utf8_decoder.push(&bytes);
                if !text.is_empty() {
                    on_chunk
                        .send(serde_json::json!({
                            "event": "chunk",
                            "data": text,
                        }))
                        .map_err(|e| format!("推送 chunk 失败: {}", e))?;
                }
            }
            Err(e) => {
                let message = stream_error_message(status, &headers_map, &e.to_string());
                on_chunk
                    .send(serde_json::json!({
                        "event": "error",
                        "message": message,
                    }))
                    .ok();
                return Err(message);
            }
        }
    }

    let tail = utf8_decoder.finish();
    if !tail.is_empty() {
        on_chunk
            .send(serde_json::json!({
                "event": "chunk",
                "data": tail,
            }))
            .map_err(|e| format!("推送 chunk 失败: {}", e))?;
    }

    on_chunk
        .send(serde_json::json!({ "event": "done" }))
        .map_err(|e| format!("推送 done 失败: {}", e))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};

    #[test]
    fn oss_upload_authorization_bypasses_cloudflare_but_legacy_upload_does_not() {
        let make_request = |path: &str, headers: Option<HashMap<String, String>>| HttpRequest {
            url: format!("https://api.jiucaihezi.studio{path}"),
            method: Some("POST".into()),
            headers,
            body: None,
            body_base64: None,
            timeout_secs: None,
        };
        assert!(should_direct_unified_api_to_newapi(&make_request(
            "/api/creations/upload-url",
            Some(HashMap::from([("Authorization".into(), "Bearer test".into())])),
        )));
        assert!(!should_direct_unified_api_to_newapi(&make_request(
            "/api/creations/uploads",
            Some(HashMap::from([("Authorization".into(), "Bearer test".into())])),
        )));
        assert!(!should_direct_unified_api_to_newapi(&make_request(
            "/api/creations/upload-url",
            Some(HashMap::from([("X-JC-Session".into(), "browser-session".into())])),
        )));
    }

    #[tokio::test]
    async fn native_http_preserves_multipart_upload_bytes() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/api/creations/uploads", listener.local_addr().unwrap());
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream.set_read_timeout(Some(std::time::Duration::from_secs(5))).unwrap();
            let mut request = Vec::new();
            let mut buffer = [0_u8; 4096];
            loop {
                let count = stream.read(&mut buffer).unwrap();
                assert!(count > 0);
                request.extend_from_slice(&buffer[..count]);
                if let Some(end) = request.windows(4).position(|part| part == b"\r\n\r\n") {
                    let headers = String::from_utf8_lossy(&request[..end]).to_lowercase();
                    let length: usize = headers.lines().find_map(|line| line.strip_prefix("content-length: ")).unwrap().parse().unwrap();
                    if request.len() >= end + 4 + length { break; }
                }
            }
            stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n{}").unwrap();
            request
        });
        let mut body = b"--jc-boundary\r\nContent-Disposition: form-data; name=\"file\"; filename=\"reference.png\"\r\nContent-Type: image/png\r\n\r\n".to_vec();
        body.extend_from_slice(&[0, 128, 255, 13, 10]);
        body.extend_from_slice(b"\r\n--jc-boundary--\r\n");
        let response = http_request(HttpRequest {
            url, method: Some("POST".into()),
            headers: Some(HashMap::from([
                ("Content-Type".into(), "multipart/form-data; boundary=jc-boundary".into()),
                ("Authorization".into(), "Bearer test-key".into()),
            ])),
            body: None, body_base64: Some(general_purpose::STANDARD.encode(&body)), timeout_secs: Some(5),
        }).await.unwrap();
        assert_eq!(response.status, 200);
        let received = server.join().unwrap();
        let end = received.windows(4).position(|part| part == b"\r\n\r\n").unwrap();
        let headers = String::from_utf8_lossy(&received[..end]).to_lowercase();
        assert!(headers.contains("multipart/form-data; boundary=jc-boundary"));
        assert!(headers.contains("authorization: bearer test-key"));
        assert_eq!(&received[end + 4..], body.as_slice());
    }

    fn serve_once(response: &'static [u8]) -> (String, std::thread::JoinHandle<()>) {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let handle = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0_u8; 1024];
            let _ = stream.read(&mut request);
            stream.write_all(response).unwrap();
        });
        (format!("http://{}", address), handle)
    }

    fn serve_stalled_once() -> (String, std::thread::JoinHandle<()>) {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let handle = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0_u8; 1024];
            let _ = stream.read(&mut request);
            std::thread::sleep(std::time::Duration::from_millis(1200));
        });
        (format!("http://{}", address), handle)
    }

    #[test]
    fn stream_error_includes_safe_response_diagnostics() {
        let mut headers = HashMap::new();
        headers.insert("content-encoding".into(), "gzip".into());
        headers.insert("x-oneapi-request-id".into(), "req_123".into());

        let message = stream_error_message(200, &headers, "error decoding response body");

        assert!(message.contains("HTTP 200"));
        assert!(message.contains("content-encoding: gzip"));
        assert!(message.contains("request-id: req_123"));
        assert!(message.contains("error decoding response body"));
    }

    #[test]
    fn document_converter_request_is_pinned_to_the_production_endpoint() {
        assert!(is_document_converter_url(
            "https://api.jiucaihezi.studio/documents/markdown"
        ));
        assert!(!is_document_converter_url(
            "http://api.jiucaihezi.studio/documents/markdown"
        ));
        assert!(!is_document_converter_url(
            "https://evil.example/documents/markdown"
        ));
        assert!(!is_document_converter_url(
            "https://api.jiucaihezi.studio/documents/markdown?next=evil"
        ));
    }

    #[test]
    fn media_content_types_are_kept_as_binary() {
        assert!(is_binary_content_type(Some("binary/octet-stream")));
        assert!(is_binary_content_type(Some("application/octet-stream")));
        assert!(is_binary_content_type(Some("video/mp4; charset=binary")));
        assert!(!is_binary_content_type(Some("application/json")));
        assert!(!is_binary_content_type(Some("text/plain")));
    }

    #[tokio::test]
    async fn project_download_atomically_promotes_a_complete_response() {
        let (url, server) = serve_once(b"HTTP/1.1 200 OK\r\nContent-Length: 5\r\nContent-Type: video/mp4\r\nConnection: close\r\n\r\nvideo");
        let response = reqwest::get(url).await.unwrap();
        let dir = tempfile::TempDir::new().unwrap();
        let target = dir.path().join("result.mp4");
        let temp = dir.path().join(".result.part");

        let (_, headers, bytes) = persist_download_response(response, &target, &temp).await.unwrap();

        server.join().unwrap();
        assert_eq!(bytes, 5);
        assert_eq!(headers.get("content-type").map(String::as_str), Some("video/mp4"));
        assert_eq!(std::fs::read(target).unwrap(), b"video");
        assert!(!temp.exists());
    }

    #[tokio::test]
    async fn media_download_allows_slow_progress_beyond_the_read_timeout() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0_u8; 1024];
            let _ = stream.read(&mut request);
            stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 5\r\nContent-Type: video/mp4\r\nConnection: close\r\n\r\nv").unwrap();
            for byte in b"ideo" {
                std::thread::sleep(std::time::Duration::from_millis(350));
                if stream.write_all(&[*byte]).is_err() { break; }
            }
        });
        let request = HttpDownloadRequest { credential_ref: None, url, headers: None, timeout_secs: Some(1) };
        let response = media_download_client(&request).unwrap().get(&request.url).send().await.unwrap();
        let dir = tempfile::TempDir::new().unwrap();
        let target = dir.path().join("result.mp4");
        let temp = dir.path().join(".result.part");
        let result = persist_download_response(response, &target, &temp).await;
        server.join().unwrap();
        assert!(result.is_ok(), "持续收到数据的下载不应按总耗时失败: {result:?}");
        assert_eq!(std::fs::read(target).unwrap(), b"video");
    }

    #[tokio::test]
    async fn project_download_rejects_empty_partial_and_error_document_responses() {
        for response_bytes in [
            &b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"[..],
            &b"HTTP/1.1 206 Partial Content\r\nContent-Length: 3\r\nContent-Range: bytes 0-2/10\r\nConnection: close\r\n\r\nbad"[..],
            &b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n{}"[..],
        ] {
            let (url, server) = serve_once(response_bytes);
            let response = reqwest::get(url).await.unwrap();
            let dir = tempfile::TempDir::new().unwrap();
            let target = dir.path().join("result.mp4");
            let temp = dir.path().join(".result.part");
            let result = persist_download_response(response, &target, &temp).await;
            server.join().unwrap();
            assert!(result.is_err(), "无效响应不能标记为媒体保存成功");
            assert!(!target.exists());
            assert!(!temp.exists());
        }
    }

    #[tokio::test]
    async fn project_download_keeps_partial_files_after_a_broken_stream() {
        let (url, server) = serve_once(b"HTTP/1.1 200 OK\r\nContent-Length: 10\r\nConnection: close\r\n\r\nbad");
        let response = reqwest::get(url).await.unwrap();
        let dir = tempfile::TempDir::new().unwrap();
        let target = dir.path().join("result.mp4");
        let temp = dir.path().join(".result.part");

        assert!(persist_download_response(response, &target, &temp).await.is_err());

        server.join().unwrap();
        assert!(!target.exists());
        assert!(temp.exists(), "断流必须保留可恢复的临时文件");
    }

    #[tokio::test]
    async fn project_download_rejects_http_failures_without_creating_files() {
        let (url, server) = serve_once(b"HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
        let response = reqwest::get(url).await.unwrap();
        let dir = tempfile::TempDir::new().unwrap();
        let target = dir.path().join("result.mp4");
        let temp = dir.path().join(".result.part");

        assert!(persist_download_response(response, &target, &temp).await.unwrap_err().contains("503"));

        server.join().unwrap();
        assert!(!target.exists());
        assert!(!temp.exists());
    }

    #[tokio::test]
    async fn project_download_timeout_does_not_create_project_files() {
        let (url, server) = serve_stalled_once();
        let dir = tempfile::TempDir::new().unwrap();
        let target = dir.path().join("result.mp4");
        let temp = dir.path().join(".result.part");
        let request = HttpDownloadRequest { credential_ref: None, url, headers: None, timeout_secs: Some(1) };
        let result = send_media_download(&media_download_client(&request).unwrap(), &request).await;

        server.join().unwrap();
        assert!(result.is_err());
        assert!(!target.exists());
        assert!(!temp.exists());
    }

    #[tokio::test]
    async fn media_download_retries_a_temporary_http_failure_once() {
        for (first_status, expected_status, expected_requests) in [(503, 200, 2), (401, 401, 1), (404, 404, 1)] {
            let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            let url = format!("http://{}", listener.local_addr().unwrap());
            listener.set_nonblocking(true).unwrap();
            let server = std::thread::spawn(move || {
                let deadline = std::time::Instant::now() + std::time::Duration::from_secs(2);
                let mut requests = 0;
                while std::time::Instant::now() < deadline {
                    match listener.accept() {
                        Ok((mut stream, _)) => {
                            stream.set_read_timeout(Some(std::time::Duration::from_secs(1))).unwrap();
                            let mut request = [0_u8; 1024];
                            let _ = stream.read(&mut request);
                            let status = if requests == 0 { first_status } else { 200 };
                            requests += 1;
                            write!(stream, "HTTP/1.1 {status} Status\r\nContent-Length: 5\r\nConnection: close\r\n\r\nvideo").unwrap();
                            if requests == expected_requests { break; }
                        }
                        Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => std::thread::sleep(std::time::Duration::from_millis(10)),
                        Err(error) => panic!("test server failed: {error}"),
                    }
                }
                requests
            });
            let request = HttpDownloadRequest { credential_ref: None, url, headers: None, timeout_secs: Some(1) };
            let response = send_media_download(&media_download_client(&request).unwrap(), &request).await.unwrap();
            let requests = server.join().unwrap();
            assert_eq!(response.status().as_u16(), expected_status);
            assert_eq!(requests, expected_requests);
        }
    }

    #[tokio::test]
    async fn project_download_rejects_paths_outside_the_project_before_network_io() {
        let dir = tempfile::TempDir::new().unwrap();
        let result = download_to_project(HttpDownloadToProjectRequest {
            root: dir.path().to_string_lossy().into_owned(),
            relative_path: "../escape.mp4".into(),
            credential_ref: None,
            url: "https://example.com/result.mp4".into(),
            headers: None,
            timeout_secs: Some(1),
        }, None, None).await;

        assert!(matches!(result, Err(message) if message.contains("路径") || message.contains("目录")));
        assert!(!dir.path().parent().unwrap().join("escape.mp4").exists());
    }
}

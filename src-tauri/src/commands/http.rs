use base64::{Engine as _, engine::general_purpose};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use futures_util::StreamExt;
use tokio::io::AsyncWriteExt;
use tauri::ipc::Channel;

#[derive(Deserialize)]
pub struct HttpRequest {
    pub url: String,
    pub method: Option<String>,
    pub headers: Option<HashMap<String, String>>,
    pub body: Option<String>,
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
    pub timeout_secs: Option<u64>,
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
        parsed.scheme() == "http"
            && matches!(parsed.host_str(), Some("127.0.0.1" | "localhost" | "::1"))
            && parsed.path() == "/upload/image"
            && parsed.query().is_none()
    })
}

fn is_newapi_passthrough_path(url: &str) -> bool {
    tauri::Url::parse(url)
        .ok()
        .map(|parsed| parsed.path().starts_with("/v1/"))
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

fn should_direct_unified_download_to_newapi(request: &HttpDownloadRequest) -> bool {
    is_unified_api_host(&request.url) && is_newapi_passthrough_path(&request.url)
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

    if let Some(body) = request.body {
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
        return Err("ComfyUI 上传地址必须是本机 /upload/image".into());
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
    let response = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(10))
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| format!("创建 ComfyUI 上传连接失败: {}", e))?
        .post(&request.url)
        .multipart(reqwest::multipart::Form::new().text("overwrite", "true").part("image", file))
        .send()
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
    request: HttpDownloadRequest,
) -> Result<HttpDownloadResponse, String> {
    let mut client_builder = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(10))
        .pool_idle_timeout(std::time::Duration::from_secs(90));
    client_builder = client_builder.timeout(std::time::Duration::from_secs(
        request.timeout_secs.unwrap_or(60),
    ));
    if should_direct_unified_download_to_newapi(&request) {
        client_builder = with_newapi_source_resolution(client_builder);
    }
    let client = client_builder
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;
    let mut request_builder = client.get(&request.url);
    if let Some(headers) = &request.headers {
        for (key, value) in headers {
            request_builder = request_builder.header(key, value);
        }
    }
    let resp = request_builder
        .send()
        .await
        .map_err(|e| format!("HTTP 下载失败: {}", e))?;
    let status = resp.status().as_u16();
    let mut headers = HashMap::new();
    for (key, value) in resp.headers() {
        if let Ok(v) = value.to_str() {
            headers.insert(key.to_string(), v.to_string());
        }
    }
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("读取下载数据失败: {}", e))?;
    Ok(HttpDownloadResponse {
        status,
        headers,
        data_base64: general_purpose::STANDARD.encode(bytes),
    })
}

#[tauri::command]
pub async fn http_download_to_project(
    request: HttpDownloadToProjectRequest,
) -> Result<HttpDownloadToProjectResponse, String> {
    crate::commands::skill_material::validate_public_http_url(&request.url)?;
    let root = crate::commands::dev::canonical_root(&request.root)?;
    let target = crate::commands::dev::resolve_write_path(&root, &request.relative_path)?;
    if target.exists() {
        return Err("目标文件已存在".into());
    }
    let parent = target.parent().ok_or_else(|| "写入路径无效".to_string())?;
    tokio::fs::create_dir_all(parent)
        .await
        .map_err(|e| format!("创建媒体目录失败: {}", e))?;
    let target = crate::commands::dev::resolve_write_path(&root, &request.relative_path)?;
    let temp = target.with_file_name(format!(
        ".{}.{}.part",
        target.file_name().and_then(|name| name.to_str()).unwrap_or("media"),
        uuid::Uuid::new_v4(),
    ));

    let mut client_builder = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(10))
        .pool_idle_timeout(std::time::Duration::from_secs(90))
        .timeout(std::time::Duration::from_secs(request.timeout_secs.unwrap_or(300)));
    let download_request = HttpDownloadRequest {
        url: request.url.clone(),
        headers: request.headers.clone(),
        timeout_secs: request.timeout_secs,
    };
    if should_direct_unified_download_to_newapi(&download_request) {
        client_builder = with_newapi_source_resolution(client_builder);
    }
    let client = client_builder.build().map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;
    let mut builder = client.get(&request.url);
    if let Some(headers) = &request.headers {
        for (key, value) in headers { builder = builder.header(key, value); }
    }
    let response = builder.send().await.map_err(|e| format!("HTTP 下载失败: {}", e))?;
    let (status, headers, bytes_written) = persist_download_response(response, &target, &temp).await?;
    Ok(HttpDownloadToProjectResponse {
        status,
        headers,
        bytes_written,
        relative_path: request.relative_path,
    })
}

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
    let result = async {
        let mut file = tokio::fs::File::create(temp).await.map_err(|e| format!("创建临时文件失败: {}", e))?;
        let mut stream = response.bytes_stream();
        let mut bytes_written = 0_u64;
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|e| format!("读取下载数据失败: {}", e))?;
            file.write_all(&chunk).await.map_err(|e| format!("写入媒体文件失败: {}", e))?;
            bytes_written += chunk.len() as u64;
        }
        file.flush().await.map_err(|e| format!("刷新媒体文件失败: {}", e))?;
        drop(file);
        tokio::fs::rename(temp, target).await.map_err(|e| format!("完成媒体文件失败: {}", e))?;
        Ok::<u64, String>(bytes_written)
    }.await;
    if result.is_err() { let _ = tokio::fs::remove_file(temp).await; }
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
            std::thread::sleep(std::time::Duration::from_millis(100));
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
    async fn project_download_removes_partial_files_after_a_broken_stream() {
        let (url, server) = serve_once(b"HTTP/1.1 200 OK\r\nContent-Length: 10\r\nConnection: close\r\n\r\nbad");
        let response = reqwest::get(url).await.unwrap();
        let dir = tempfile::TempDir::new().unwrap();
        let target = dir.path().join("result.mp4");
        let temp = dir.path().join(".result.part");

        assert!(persist_download_response(response, &target, &temp).await.is_err());

        server.join().unwrap();
        assert!(!target.exists());
        assert!(!temp.exists());
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
        let result = reqwest::Client::builder()
            .timeout(std::time::Duration::from_millis(10))
            .build().unwrap()
            .get(url).send().await;

        server.join().unwrap();
        assert!(result.is_err());
        assert!(!target.exists());
        assert!(!temp.exists());
    }

    #[tokio::test]
    async fn project_download_rejects_paths_outside_the_project_before_network_io() {
        let dir = tempfile::TempDir::new().unwrap();
        let result = http_download_to_project(HttpDownloadToProjectRequest {
            root: dir.path().to_string_lossy().into_owned(),
            relative_path: "../escape.mp4".into(),
            url: "https://example.com/result.mp4".into(),
            headers: None,
            timeout_secs: Some(1),
        }).await;

        assert!(matches!(result, Err(message) if message.contains("路径") || message.contains("目录")));
        assert!(!dir.path().parent().unwrap().join("escape.mp4").exists());
    }
}

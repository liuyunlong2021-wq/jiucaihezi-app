use base64::{engine::general_purpose, Engine as _};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
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
}

#[derive(Deserialize)]
pub struct HttpDownloadRequest {
    pub url: String,
    pub timeout_secs: Option<u64>,
}

#[derive(Serialize)]
pub struct HttpDownloadResponse {
    pub status: u16,
    pub headers: HashMap<String, String>,
    pub data_base64: String,
}

fn is_unified_api_host(url: &str) -> bool {
    tauri::Url::parse(url)
        .ok()
        .and_then(|parsed| parsed.host_str().map(|host| host == "api.jiucaihezi.studio"))
        .unwrap_or(false)
}

fn is_newapi_passthrough_path(url: &str) -> bool {
    tauri::Url::parse(url)
        .ok()
        .map(|parsed| parsed.path().starts_with("/v1/"))
        .unwrap_or(false)
}

fn has_gateway_session_header(headers: &Option<HashMap<String, String>>) -> bool {
    headers.as_ref().is_some_and(|headers| {
        headers.keys().any(|key| key.eq_ignore_ascii_case("x-jc-session"))
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

fn with_newapi_source_resolution(mut client_builder: reqwest::ClientBuilder) -> reqwest::ClientBuilder {
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
    let header = |name: &str| headers.iter()
        .find(|(key, _)| key.eq_ignore_ascii_case(name))
        .map(|(_, value)| value.as_str())
        .unwrap_or("none");
    let request_id = ["x-oneapi-request-id", "x-request-id", "cf-ray"]
        .iter()
        .find_map(|name| headers.iter()
            .find(|(key, _)| key.eq_ignore_ascii_case(name))
            .map(|(_, value)| value.as_str()))
        .unwrap_or("none");

    format!(
        "读取流失败: {} (HTTP {}, content-encoding: {}, request-id: {})",
        detail,
        status,
        header("content-encoding"),
        request_id,
    )
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

    let method = match request.method.as_deref().unwrap_or("GET").to_uppercase().as_str() {
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

    let resp = req.send().await.map_err(|e| format!("HTTP 请求失败: {}", e))?;

    let status = resp.status().as_u16();
    let mut headers = HashMap::new();
    for (key, value) in resp.headers() {
        if let Ok(v) = value.to_str() {
            headers.insert(key.to_string(), v.to_string());
        }
    }
    let body = resp.text().await.map_err(|e| format!("读取响应失败: {}", e))?;

    Ok(HttpResponse { status, headers, body })
}

#[tauri::command]
pub async fn http_download_base64(request: HttpDownloadRequest) -> Result<HttpDownloadResponse, String> {
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
    let resp = client
        .get(&request.url)
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
    let bytes = resp.bytes().await.map_err(|e| format!("读取下载数据失败: {}", e))?;
    Ok(HttpDownloadResponse {
        status,
        headers,
        data_base64: general_purpose::STANDARD.encode(bytes),
    })
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

    let method = match request.method.as_deref().unwrap_or("GET").to_uppercase().as_str() {
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

    let resp = req.send().await.map_err(|e| format!("HTTP 请求失败: {}", e))?;

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
}

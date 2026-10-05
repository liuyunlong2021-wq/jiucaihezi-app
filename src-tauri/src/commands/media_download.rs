//! A retry spans headers AND body. Only validated ranges may append to a stable partial file.
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, path::Path, time::Duration};
use tokio::io::AsyncWriteExt;
use tokio::sync::watch;

#[derive(Default, Deserialize, Serialize)]
pub(crate) struct Checkpoint {
    identity: String,
    validator: Option<String>,
    total: Option<u64>,
}

#[derive(Clone, Serialize)]
pub(crate) struct Progress {
    pub bytes: u64,
    pub total: Option<u64>,
    pub attempt: usize,
}

pub(crate) fn identity(url: &str) -> String {
    use sha2::{Digest, Sha256};
    // Signed URL refreshes preserve the resource path; If-Range protects its version.
    let mut url = reqwest::Url::parse(url).expect("validated URL");
    let query: Vec<_> = url.query_pairs().filter(|(key, _)| {
        let key = key.to_ascii_lowercase();
        !matches!(key.as_str(), "signature" | "token" | "expires" | "policy" | "key-pair-id" | "sig" | "auth_key")
            && !key.starts_with("x-amz-") && !key.starts_with("x-goog-") && !key.starts_with("x-oss-")
    }).map(|(k, v)| (k.into_owned(), v.into_owned())).collect();
    url.set_query(None);
    if !query.is_empty() { url.query_pairs_mut().extend_pairs(query); }
    format!("{:x}", Sha256::digest(url.as_str().as_bytes()))
}

fn validator(headers: &reqwest::header::HeaderMap) -> Option<String> {
    headers.get("etag").and_then(|h| h.to_str().ok()).filter(|s| !s.starts_with("W/"))
        .or_else(|| headers.get("last-modified").and_then(|h| h.to_str().ok())).map(str::to_owned)
}

fn range(value: &str) -> Option<(u64, u64, u64)> {
    let (span, total) = value.strip_prefix("bytes ")?.split_once('/')?;
    let (start, end) = span.split_once('-')?;
    let (start, end, total) = (start.parse().ok()?, end.parse().ok()?, total.parse().ok()?);
    (start <= end && end < total).then_some((start, end, total))
}

pub(crate) async fn checkpoint_matches(meta: &Path, url: &str, target: &Path) -> bool {
    let length = tokio::fs::metadata(target).await.map(|m| m.len()).unwrap_or(0);
    tokio::fs::read(meta).await.ok().and_then(|data| serde_json::from_slice::<Checkpoint>(&data).ok())
        .is_some_and(|saved| saved.identity == identity(url) && length > 0 && saved.total == Some(length))
}

pub(crate) async fn download(
    client: &reqwest::Client, url: &str, headers: &HashMap<String, String>,
    temp: &Path, meta: &Path, mut cancel: watch::Receiver<bool>,
    progress: impl Fn(Progress),
) -> Result<(HashMap<String, String>, u64), String> {
    let resource = identity(url);
    let mut saved = tokio::fs::read(meta).await.ok()
        .and_then(|data| serde_json::from_slice::<Checkpoint>(&data).ok()).unwrap_or_default();
    if saved.identity != resource {
        // A refreshed result may use a new path; never append its bytes to an old resource.
        saved = Checkpoint { identity: resource, ..Default::default() };
    }
    for attempt in 0..4 {
        if *cancel.borrow() { return Err("下载已暂停".into()); }
        let offset = if saved.validator.is_some() { tokio::fs::metadata(temp).await.map(|m| m.len()).unwrap_or(0) } else { 0 };
        let mut request = client.get(url).header("Accept-Encoding", "identity");
        for (key, value) in headers { request = request.header(key, value); }
        if offset > 0 {
            request = request.header("Range", format!("bytes={offset}-"))
                .header("If-Range", saved.validator.as_deref().unwrap());
        }
        let response = tokio::select! {
            _ = cancel.changed() => return Err("下载已暂停".into()),
            response = request.send() => response,
        };
        let mut retry_delay = Duration::from_secs(1 << attempt);
        let mut retry_error = match response {
            Err(error) => Some(format!("下载连接失败：{}", super::http::download_error_detail(error))),
            Ok(response) => {
                let status = response.status().as_u16();
                if matches!(status, 408 | 429 | 500 | 502 | 503 | 504) {
                    if let Some(seconds) = response.headers().get("retry-after").and_then(|h| h.to_str().ok()).and_then(|h| h.parse::<u64>().ok()) {
                        retry_delay = Duration::from_secs(seconds.min(60));
                    }
                    Some(format!("HTTP 下载暂不可用：{status}"))
                } else if status == 416 && offset > 0 {
                    // Re-fetch a whole response; 416 alone cannot establish a valid completed file.
                    saved.validator = None;
                    Some("服务器拒绝续传，改为完整下载".into())
                } else if status != 200 && status != 206 {
                    return Err(format!("HTTP 下载失败：{status}"));
                } else {
                    let response_headers = response.headers().clone();
                    let content_type = response_headers.get("content-type").and_then(|h| h.to_str().ok()).unwrap_or("").split(';').next().unwrap_or("");
                    let ext = temp.file_name().and_then(|s| s.to_str()).unwrap_or("");
                    if (["mp4", "webm", "mov", "png", "jpg", "jpeg", "webp", "gif", "mp3", "wav", "ogg", "m4a"].iter().any(|kind| ext.contains(&format!(".{kind}."))))
                        && (content_type == "text/html" || content_type == "application/json" || content_type.ends_with("+json")) {
                        return Err("下载返回错误页面而非媒体".into());
                    }
                    let received_validator = validator(&response_headers);
                    let (start, total) = if status == 206 {
                        let (start, _, total) = response_headers.get("content-range").and_then(|h| h.to_str().ok()).and_then(range)
                            .ok_or_else(|| "续传响应范围无效".to_string())?;
                        if offset == 0 || start != offset || saved.total.is_some_and(|old| old != total)
                            || received_validator.as_ref().is_some_and(|value| Some(value) != saved.validator.as_ref()) {
                            return Err("续传响应与已有文件不一致，未追加".into());
                        }
                        (start, Some(total))
                    } else { (0, response.content_length()) };
                    saved.validator = received_validator.or_else(|| (status == 206).then(|| saved.validator.clone()).flatten());
                    saved.total = total;
                    // Truncate an obsolete version before committing its new validator.
                    let mut file = tokio::fs::OpenOptions::new().create(true).write(true)
                        .truncate(start == 0).append(start > 0).open(temp).await.map_err(|_| "打开下载临时文件失败")?;
                    // No credentials or signed URLs are stored.
                    let staging = meta.with_extension("json.tmp");
                    tokio::fs::write(&staging, serde_json::to_vec(&saved).unwrap()).await.map_err(|_| "写入下载断点失败")?;
                    if meta.exists() { tokio::fs::remove_file(meta).await.map_err(|_| "更新下载断点失败")?; }
                    tokio::fs::rename(staging, meta).await.map_err(|_| "提交下载断点失败")?;
                    let mut stream = response.bytes_stream();
                    let mut bytes = start;
                    let mut error = None;
                    progress(Progress { bytes, total, attempt });
                    loop {
                        let chunk = tokio::select! {
                            _ = cancel.changed() => { file.flush().await.ok(); return Err("下载已暂停".into()); },
                            chunk = stream.next() => chunk,
                        };
                        match chunk {
                            None => break,
                            Some(Err(cause)) => { error = Some(format!("下载中断：{}", super::http::download_error_detail(cause))); break; },
                            Some(Ok(chunk)) => {
                                file.write_all(&chunk).await.map_err(|_| "写入媒体文件失败，请检查磁盘空间")?;
                                bytes += chunk.len() as u64;
                                progress(Progress { bytes, total, attempt });
                            }
                        }
                    }
                    file.flush().await.map_err(|_| "刷新下载文件失败")?;
                    if error.is_none() && bytes > 0 && total.is_none_or(|total| bytes == total) {
                        file.sync_all().await.map_err(|_| "保存下载文件失败")?;
                        saved.total = Some(bytes);
                        tokio::fs::write(meta, serde_json::to_vec(&saved).unwrap()).await.map_err(|_| "保存完成断点失败")?;
                        return Ok((response_headers.iter().filter_map(|(k, v)| v.to_str().ok().map(|v| (k.to_string(), v.to_string()))).collect(), bytes));
                    }
                    error.or_else(|| Some("下载文件长度不完整".into()))
                }
            }
        };
        if attempt == 3 { return Err(retry_error.take().unwrap_or_else(|| "下载失败".into())); }
        tokio::select! {
            _ = cancel.changed() => return Err("下载已暂停".into()),
            _ = tokio::time::sleep(retry_delay) => {},
        }
    }
    unreachable!()
}

/// Validate MP4/MOV atom boundaries without a whole-file allocation or external tools.
pub(crate) async fn validate_container(path: &Path) -> Result<(), String> {
    use tokio::io::{AsyncReadExt, AsyncSeekExt};
    let mut file = tokio::fs::File::open(path).await.map_err(|_| "无法读取下载视频")?;
    let size = file.metadata().await.map_err(|_| "无法读取视频长度")?.len();
    let invalid = || "视频容器不完整或不可识别，已保留临时文件".to_string();
    if size < 16 { return Err(invalid()); }
    let mut header = [0; 8];
    file.read_exact(&mut header).await.map_err(|_| invalid())?;
    if header[..4] == [0x1a, 0x45, 0xdf, 0xa3] {
        // WebM uses EBML, not MP4 atoms. Check its required structural markers.
        file.seek(std::io::SeekFrom::Start(0)).await.map_err(|_| invalid())?;
        let mut prefix = vec![0; size.min(1024 * 1024) as usize];
        file.read_exact(&mut prefix).await.map_err(|_| invalid())?;
        if prefix.windows(4).any(|w| w == [0x18, 0x53, 0x80, 0x67])
            && prefix.windows(4).any(|w| w == [0x16, 0x54, 0xae, 0x6b]) { return Ok(()); }
        return Err(invalid());
    }
    let mut offset = 0;
    let mut moov = false;
    let mut mdat = false;
    let mut video_track = false;
    while offset < size {
        if size - offset < 8 { return Err(invalid()); }
        file.seek(std::io::SeekFrom::Start(offset)).await.map_err(|_| invalid())?;
        file.read_exact(&mut header).await.map_err(|_| invalid())?;
        let length = u32::from_be_bytes(header[..4].try_into().unwrap()) as u64;
        let mut head_size = 8;
        let length = if length == 1 {
            let mut extended = [0; 8];
            file.read_exact(&mut extended).await.map_err(|_| invalid())?;
            head_size = 16;
            u64::from_be_bytes(extended)
        } else if length == 0 { size - offset } else { length };
        if length < head_size || length > size - offset { return Err(invalid()); }
        if &header[4..] == b"moov" {
            moov = true;
            // A normal moov is small; refuse a huge malformed index rather than allocate it.
            if length > 16 * 1024 * 1024 { return Err(invalid()); }
            let mut index = vec![0; (length - head_size) as usize];
            file.read_exact(&mut index).await.map_err(|_| invalid())?;
            video_track = index.windows(4).any(|w| w == b"vide") && index.windows(4).any(|w| w == b"trak");
        }
        if &header[4..] == b"mdat" { mdat |= length > head_size; }
        offset += length;
    }
    if moov && mdat && video_track { Ok(()) } else { Err(invalid()) }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    #[tokio::test]
    async fn broken_body_resumes_with_verified_range() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/video", listener.local_addr().unwrap());
        let server = std::thread::spawn(move || {
            for index in 0..2 {
                let (mut socket, _) = listener.accept().unwrap();
                let mut buffer = [0; 4096];
                let n = socket.read(&mut buffer).unwrap();
                let request = String::from_utf8_lossy(&buffer[..n]).to_lowercase();
                if index == 0 {
                    socket.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 10\r\nETag: \"v1\"\r\nConnection: close\r\n\r\n12345").unwrap();
                } else {
                    assert!(request.contains("range: bytes=5-"), "{request}");
                    assert!(request.contains("if-range: \"v1\""));
                    socket.write_all(b"HTTP/1.1 206 Partial Content\r\nContent-Length: 5\r\nContent-Range: bytes 5-9/10\r\nETag: \"v1\"\r\nConnection: close\r\n\r\n67890").unwrap();
                }
            }
        });
        let dir = tempfile::TempDir::new().unwrap();
        let temp = dir.path().join("video.mp4.part");
        let meta = dir.path().join("video.mp4.part.json");
        let (_tx, rx) = watch::channel(false);
        let (_, bytes) = download(&reqwest::Client::new(), &url, &HashMap::new(), &temp, &meta, rx, |_| {}).await.unwrap();
        server.join().unwrap();
        assert_eq!(bytes, 10);
        assert_eq!(tokio::fs::read(temp).await.unwrap(), b"1234567890");
    }
    #[test]
    fn ranges_are_strict() {
        assert_eq!(range("bytes 5-9/10"), Some((5, 9, 10)));
        for value in ["bytes 5-10/10", "bytes 9-5/10", "bytes 5-9/*", "garbage"] { assert_eq!(range(value), None); }
    }
    fn scripted_server(responses: Vec<&'static [u8]>) -> (String, std::thread::JoinHandle<Vec<String>>) {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/video", listener.local_addr().unwrap());
        listener.set_nonblocking(true).unwrap();
        let server = std::thread::spawn(move || {
            let mut requests = vec![];
            let deadline = std::time::Instant::now() + Duration::from_secs(12);
            for response in responses {
                loop {
                    match listener.accept() {
                        Ok((mut socket, _)) => {
                            socket.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
                            let mut buffer = [0; 4096];
                            let n = socket.read(&mut buffer).unwrap();
                            requests.push(String::from_utf8_lossy(&buffer[..n]).to_lowercase());
                            let _ = socket.write_all(response);
                            break;
                        },
                        Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                            if std::time::Instant::now() >= deadline { return requests; }
                            std::thread::sleep(Duration::from_millis(10));
                        },
                        Err(error) => panic!("{error}"),
                    }
                }
            }
            requests
        });
        (url, server)
    }

    #[tokio::test]
    async fn cancelled_download_reopens_its_checkpoint() {
        let (url, server) = scripted_server(vec![
            b"HTTP/1.1 200 OK\r\nContent-Length: 10\r\nETag: \"v1\"\r\nConnection: close\r\n\r\n12345",
            b"HTTP/1.1 206 Partial Content\r\nContent-Length: 5\r\nContent-Range: bytes 5-9/10\r\nETag: \"v1\"\r\nConnection: close\r\n\r\n67890",
        ]);
        let dir = tempfile::TempDir::new().unwrap();
        let temp = dir.path().join("video.mp4.part");
        let meta = dir.path().join("video.mp4.part.json");
        let (tx, rx) = watch::channel(false);
        let client = reqwest::Client::new();
        let first = download(&client, &url, &HashMap::new(), &temp, &meta, rx, |p| { if p.bytes > 0 { let _ = tx.send(true); } }).await;
        assert!(first.unwrap_err().contains("暂停"));
        assert_eq!(tokio::fs::metadata(&temp).await.unwrap().len(), 5);
        let (_tx, rx) = watch::channel(false);
        download(&client, &url, &HashMap::new(), &temp, &meta, rx, |_| {}).await.unwrap();
        let requests = server.join().unwrap();
        assert_eq!(requests.len(), 2);
        assert!(requests[1].contains("range: bytes=5-"));
        assert_eq!(tokio::fs::read(temp).await.unwrap(), b"1234567890");
    }

    #[tokio::test]
    async fn ignored_range_replaces_partial_instead_of_appending() {
        let (url, server) = scripted_server(vec![
            b"HTTP/1.1 200 OK\r\nContent-Length: 10\r\nETag: \"v1\"\r\nConnection: close\r\n\r\n12345",
            b"HTTP/1.1 200 OK\r\nContent-Length: 10\r\nETag: \"v2\"\r\nConnection: close\r\n\r\nabcdefghij",
        ]);
        let dir = tempfile::TempDir::new().unwrap();
        let temp = dir.path().join("video.mp4.part");
        let meta = dir.path().join("video.mp4.part.json");
        let (_tx, rx) = watch::channel(false);
        download(&reqwest::Client::new(), &url, &HashMap::new(), &temp, &meta, rx, |_| {}).await.unwrap();
        assert_eq!(server.join().unwrap().len(), 2);
        assert_eq!(tokio::fs::read(temp).await.unwrap(), b"abcdefghij");
    }

    #[tokio::test]
    async fn wrong_range_never_appends_and_authentication_failure_is_not_retried() {
        for (response, expected) in [
            (&b"HTTP/1.1 206 Partial Content\r\nContent-Length: 5\r\nContent-Range: bytes 0-4/10\r\nETag: \"v1\"\r\nConnection: close\r\n\r\n67890"[..], "不一致"),
            (&b"HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"[..], "401"),
        ] {
            let (url, server) = scripted_server(vec![response]);
            let dir = tempfile::TempDir::new().unwrap();
            let temp = dir.path().join("video.mp4.part");
            let meta = dir.path().join("video.mp4.part.json");
            tokio::fs::write(&temp, b"12345").await.unwrap();
            tokio::fs::write(&meta, serde_json::to_vec(&Checkpoint { identity: identity(&url), validator: Some("\"v1\"".into()), total: Some(10) }).unwrap()).await.unwrap();
            let (_tx, rx) = watch::channel(false);
            let result = download(&reqwest::Client::new(), &url, &HashMap::new(), &temp, &meta, rx, |_| {}).await;
            assert!(result.unwrap_err().contains(expected));
            assert_eq!(server.join().unwrap().len(), 1);
            assert_eq!(tokio::fs::read(temp).await.unwrap(), b"12345");
        }
    }

    #[tokio::test]
    async fn temporary_status_is_retried_and_checkpoint_contains_no_url_secrets() {
        let (url, server) = scripted_server(vec![
            b"HTTP/1.1 503 Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
            b"HTTP/1.1 200 OK\r\nContent-Length: 5\r\nConnection: close\r\n\r\nvideo",
        ]);
        let dir = tempfile::TempDir::new().unwrap();
        let temp = dir.path().join("video.mp4.part");
        let meta = dir.path().join("video.mp4.part.json");
        let (_tx, rx) = watch::channel(false);
        let headers = HashMap::from([("Authorization".into(), "Bearer local-secret".into())]);
        download(&reqwest::Client::new(), &format!("{url}?signature=secret"), &headers, &temp, &meta, rx, |_| {}).await.unwrap();
        assert_eq!(server.join().unwrap().len(), 2);
        assert!(!tokio::fs::read_to_string(meta).await.unwrap().contains("secret"));
    }

    #[tokio::test]
    async fn container_validation_does_not_require_ffprobe_and_rejects_truncated_atoms() {
        let root = tempfile::TempDir::new().unwrap();
        let path = root.path().join("video.mp4");
        let mut bytes = Vec::new();
        for (kind, payload) in [(b"ftyp", &b"isom0000"[..]), (b"moov", &b"trak----vide"[..]), (b"mdat", &b"frame"[..])] {
            bytes.extend_from_slice(&((payload.len() + 8) as u32).to_be_bytes());
            bytes.extend_from_slice(kind);
            bytes.extend_from_slice(payload);
        }
        tokio::fs::write(&path, &bytes).await.unwrap();
        validate_container(&path).await.unwrap();
        bytes.pop();
        tokio::fs::write(&path, bytes).await.unwrap();
        assert!(validate_container(&path).await.is_err());
        tokio::fs::write(&path, b"<!doctype html>error page").await.unwrap();
        assert!(validate_container(&path).await.is_err());
    }

}

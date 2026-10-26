use super::{kill_process_tree, lock_processes, mcp_kill_stdio, mcp_spawn_stdio, Owner};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use std::time::Duration;
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::Manager;

const PACKAGE: &str = "@basketikun/canvas-agent@0.6.0";
const PROTOCOL: u64 = 6;
static START: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
static BRIDGE: LazyLock<Mutex<Bridge>> = LazyLock::new(|| Mutex::new(Bridge::default()));

#[derive(Default)]
struct Bridge {
    handle: Option<String>,
    leases: HashMap<String, Owner>,
}

#[derive(Deserialize)]
struct Config {
    url: String,
    token: String,
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CanvasStatus {
    ready: bool,
    project_title: String,
}

fn lock_bridge() -> std::sync::MutexGuard<'static, Bridge> {
    BRIDGE.lock().unwrap_or_else(|e| e.into_inner())
}

fn validate_url(value: &str) -> Result<reqwest::Url, String> {
    let url = reqwest::Url::parse(value).map_err(|_| "画布本地地址无效")?;
    if url.scheme() != "http"
        || !matches!(url.host_str(), Some("127.0.0.1" | "localhost" | "[::1]"))
        || !url.username().is_empty()
        || url.password().is_some()
        || url.path() != "/"
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("画布服务地址必须是本机 HTTP 地址".into());
    }
    Ok(url)
}

fn read_config() -> Result<Option<Config>, String> {
    let path =
        crate::skills::path_utils::resolve_home_dir().join(".infinite-canvas/canvas-agent.json");
    let raw = match std::fs::read(path) {
        Ok(raw) => raw,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err("无法读取本地画布配置，请检查文件权限".into()),
    };
    let config: Config =
        serde_json::from_slice(&raw).map_err(|_| "本地画布配置损坏，已保留原文件")?;
    validate_url(&config.url)?;
    if config.token.is_empty() {
        return Err("本地画布配置缺少连接凭据，已保留原文件".into());
    }
    Ok(Some(config))
}

fn client(timeout_ms: u64) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_millis(timeout_ms))
        .build()
        .map_err(|_| "无法创建画布连接".into())
}

async fn health(client: &reqwest::Client, url: &str) -> Result<bool, String> {
    let response = match client
        .get(format!("{}/health", url.trim_end_matches('/')))
        .send()
        .await
    {
        Ok(response) => response,
        Err(e) if e.is_connect() => return Ok(false),
        Err(_) => return Err("本地画布服务未响应，请检查后重新连接".into()),
    };
    if !response.status().is_success() {
        return Err("画布端口已被其他服务占用".into());
    }
    let body: serde_json::Value = response
        .json()
        .await
        .map_err(|_| "画布端口未返回有效协议，请勿关闭其他程序")?;
    if body.get("ok").and_then(|v| v.as_bool()) != Some(true)
        || body.get("protocolVersion").and_then(|v| v.as_u64()) != Some(PROTOCOL)
    {
        return Err("本地 Canvas Agent 协议不匹配，请更新服务后重新连接".into());
    }
    Ok(true)
}

async fn authenticate(client: &reqwest::Client, config: &Config) -> Result<(), String> {
    let response = client
        .get(format!(
            "{}/agent/codex/workspace",
            config.url.trim_end_matches('/')
        ))
        .header("x-canvas-agent-token", &config.token)
        .send()
        .await
        .map_err(|_| "本地画布认证请求失败")?;
    if !response.status().is_success() {
        return Err("本地画布 token 验证失败，请检查现有服务配置".into());
    }
    let body: serde_json::Value = response.json().await.map_err(|_| "本地画布认证响应无效")?;
    if body.get("ok").and_then(|v| v.as_bool()) != Some(true) {
        return Err("本地画布认证失败".into());
    }
    Ok(())
}

fn status_from_snapshot(value: &serde_json::Value) -> CanvasStatus {
    let Some(result) = value.get("result") else {
        return CanvasStatus::default();
    };
    let ready = value.get("ok").and_then(|v| v.as_bool()) == Some(true)
        && result
            .get("projectId")
            .and_then(|v| v.as_str())
            .is_some_and(|id| !id.is_empty())
        && result.get("nodes").is_some_and(|v| v.is_array())
        && result.get("connections").is_some_and(|v| v.is_array());
    CanvasStatus {
        ready,
        project_title: if ready {
            result
                .get("title")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .into()
        } else {
            String::new()
        },
    }
}

async fn read_status(client: &reqwest::Client, config: &Config) -> Result<CanvasStatus, String> {
    if !health(client, &config.url).await? {
        return Err("本地画布服务已停止".into());
    }
    authenticate(client, config).await?;
    let response = client
        .post(format!("{}/api/tools", config.url.trim_end_matches('/')))
        .header("x-canvas-agent-token", &config.token)
        .json(&serde_json::json!({"name":"canvas_get_state","input":{}}))
        .send()
        .await
        .map_err(|_| "无法读取画布状态")?;
    if response.status() == reqwest::StatusCode::UNAUTHORIZED {
        return Err("本地画布 token 已失效".into());
    }
    let value: serde_json::Value = response.json().await.map_err(|_| "画布状态响应无效")?;
    Ok(status_from_snapshot(&value))
}

fn check_lease(window: &str, lease: &str) -> Result<(), String> {
    if !lock_bridge()
        .leases
        .get(lease)
        .is_some_and(|owner| owner.window == window)
    {
        return Err("画布连接已取消或未连接".into());
    }
    Ok(())
}

fn stop_if_unused(bridge: &mut Bridge) {
    if !bridge.leases.is_empty() {
        return;
    }
    if let Some(handle) = bridge.handle.take() {
        let mut processes = lock_processes();
        if let Some(process) = processes.remove(&handle) {
            if let Err(e) = kill_process_tree(process.pid) {
                processes.insert(handle.clone(), process);
                bridge.handle = Some(handle);
                eprintln!("[Canvas Agent] {e}");
            }
        }
    }
}

pub fn release_window(window: &str) {
    let mut bridge = lock_bridge();
    bridge.leases.retain(|_, owner| owner.window != window);
    stop_if_unused(&mut bridge);
}

#[tauri::command]
pub fn canvas_agent_release(window: tauri::WebviewWindow, lease_id: String) {
    let mut bridge = lock_bridge();
    if bridge
        .leases
        .get(&lease_id)
        .is_some_and(|owner| owner.window == window.label())
    {
        bridge.leases.remove(&lease_id);
    }
    stop_if_unused(&mut bridge);
}

#[tauri::command]
pub async fn canvas_agent_connect(
    window: tauri::WebviewWindow,
    lease_id: String,
    realm: String,
    timeout_ms: u64,
) -> Result<CanvasStatus, String> {
    #[cfg(not(any(target_os = "ios", target_os = "android")))]
    let _update_task = crate::commands::desktop_update::native_task(window.app_handle(), "连接画布")?;
    let _start = START.lock().await;
    if window.get_webview_window(window.label()).is_none() {
        return Err("画布连接已取消".into());
    }
    {
        let mut bridge = lock_bridge();
        if bridge
            .leases
            .get(&lease_id)
            .is_some_and(|owner| owner.window != window.label())
        {
            return Err("画布连接不属于当前窗口".into());
        }
        // 新 realm 接手同一窗口，保留共享桥而不是先杀后起。
        bridge
            .leases
            .retain(|_, owner| owner.window != window.label() || owner.realm == realm);
        bridge.leases.insert(
            lease_id.clone(),
            Owner {
                window: window.label().into(),
                realm,
            },
        );
    }
    let result = async {
        let client = client(timeout_ms)?;
        let config = read_config()?;
        let url = config
            .as_ref()
            .map(|c| c.url.as_str())
            .unwrap_or("http://127.0.0.1:17371");
        if !health(&client, url).await? {
            let (send, receive) = tokio::sync::oneshot::channel::<Result<(), String>>();
            let send = std::sync::Arc::new(Mutex::new(Some(send)));
            let stdout_send = send.clone();
            let stdout = Channel::new(move |body| {
                if let InvokeResponseBody::Json(raw) = body {
                    if let Ok(line) = serde_json::from_str::<String>(&raw) {
                        let result = if line.starts_with("Connect token: ") {
                            Some(Ok(()))
                        } else if line == "__MCP_EOF__" {
                            Some(Err(
                                "Canvas Agent 启动失败；请检查 Node/npm 与 npm 下载网络".into(),
                            ))
                        } else {
                            None
                        };
                        if let Some(result) = result {
                            if let Some(send) =
                                stdout_send.lock().unwrap_or_else(|e| e.into_inner()).take()
                            {
                                let _ = send.send(result);
                            }
                        }
                    }
                }
                Ok(())
            });
            let stderr = Channel::new(|_| Ok(()));
            let exit = Channel::new(move |_| {
                if let Some(send) = send.lock().unwrap_or_else(|e| e.into_inner()).take() {
                    let _ = send.send(Err(
                        "Canvas Agent 进程提前退出，请检查 Node/npm 和包下载".into()
                    ));
                }
                Ok(())
            });
            let mut env = HashMap::new();
            env.insert(
                "PORT".into(),
                validate_url(url)?
                    .port_or_known_default()
                    .unwrap()
                    .to_string(),
            );
            let handle = mcp_spawn_stdio(
                window.clone(),
                "npx".into(),
                vec!["-y".into(), PACKAGE.into()],
                None,
                Some(env),
                "canvas-bridge".into(),
                stdout,
                stderr,
                exit,
            )
            .await?;
            // 共享服务不归属首个窗口；退出/升级仍由总进程登记表收尾。
            if let Some(process) = lock_processes().get_mut(&handle) {
                process.owner = None;
            }
            lock_bridge().handle = Some(handle.clone());
            let startup = tokio::time::timeout(Duration::from_millis(timeout_ms), receive).await;
            if !matches!(startup, Ok(Ok(Ok(())))) {
                mcp_kill_stdio(handle).await?;
                lock_bridge().handle = None;
                return Err(match startup {
                    Ok(Ok(Err(error))) => error,
                    _ => "Canvas Agent 在现有 MCP 连接时限内未启动；请检查 npm 网络后重试".into(),
                });
            }
        }
        check_lease(window.label(), &lease_id)?;
        let config = read_config()?.ok_or("本地画布服务缺少配置，不能自动填写连接凭据")?;
        read_status(&client, &config).await
    }
    .await;
    if result.is_err() {
        canvas_agent_release(window, lease_id);
    }
    result
}

#[tauri::command]
pub async fn canvas_agent_status(
    window: tauri::WebviewWindow,
    lease_id: String,
) -> Result<CanvasStatus, String> {
    check_lease(window.label(), &lease_id)?;
    let config = read_config()?.ok_or("缺少本地画布连接配置")?;
    read_status(&client(30_000)?, &config).await
}

fn open_url(config: &Config, new_canvas: bool) -> Result<String, String> {
    validate_url(&config.url)?;
    let mut url = reqwest::Url::parse("https://huabu.jiucaihezi.studio/canvas").unwrap();
    url.query_pairs_mut()
        .append_pair("mode", if new_canvas { "new" } else { "recent" });
    let fragment = reqwest::Url::parse_with_params(
        "http://localhost",
        [
            ("agentUrl", config.url.as_str()),
            ("agentToken", config.token.as_str()),
            ("agentMode", "tools"),
        ],
    )
    .unwrap();
    url.set_fragment(fragment.query());
    Ok(url.into())
}

#[tauri::command]
pub async fn canvas_agent_open(
    window: tauri::WebviewWindow,
    lease_id: String,
    new_canvas: bool,
) -> Result<CanvasStatus, String> {
    use tauri_plugin_opener::OpenerExt;
    check_lease(window.label(), &lease_id)?;
    let config = read_config()?.ok_or("缺少本地画布连接配置")?;
    let status = read_status(&client(30_000)?, &config).await?;
    check_lease(window.label(), &lease_id)?;
    window
        .app_handle()
        .opener()
        .open_url(
            open_url(&config, new_canvas && !status.ready)?,
            None::<&str>,
        )
        .map_err(|_| "无法打开浏览器，请重试打开画布")?;
    Ok(status)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};

    fn mock_service(
        responses: Vec<(u16, serde_json::Value)>,
    ) -> (String, std::thread::JoinHandle<()>) {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let worker = std::thread::spawn(move || {
            for (status, body) in responses {
                let (mut stream, _) = listener.accept().unwrap();
                let mut request = Vec::new();
                loop {
                    let mut bytes = [0; 2048];
                    let count = stream.read(&mut bytes).unwrap();
                    if count == 0 {
                        break;
                    }
                    request.extend_from_slice(&bytes[..count]);
                    if let Some(end) = request.windows(4).position(|w| w == b"\r\n\r\n") {
                        let headers = String::from_utf8_lossy(&request[..end]).to_lowercase();
                        let length = headers
                            .lines()
                            .find_map(|line| {
                                line.strip_prefix("content-length:")
                                    .and_then(|v| v.trim().parse::<usize>().ok())
                            })
                            .unwrap_or(0);
                        if request.len() >= end + 4 + length {
                            break;
                        }
                    }
                }
                let body = body.to_string();
                write!(stream, "HTTP/1.1 {status} Test\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).unwrap();
            }
        });
        (url, worker)
    }

    #[tokio::test]
    async fn protocol_and_auth_are_required_before_reading_a_canvas() {
        let (url, worker) = mock_service(vec![(
            200,
            serde_json::json!({"ok":true,"protocolVersion":5}),
        )]);
        assert!(health(&client(30_000).unwrap(), &url)
            .await
            .unwrap_err()
            .contains("协议不匹配"));
        worker.join().unwrap();

        let (url, worker) = mock_service(vec![
            (
                200,
                serde_json::json!({"ok":true,"protocolVersion":6,"hasCanvas":true}),
            ),
            (401, serde_json::json!({"error":"invalid token"})),
        ]);
        let config = Config {
            url,
            token: "private-test-token".into(),
        };
        let error = read_status(&client(30_000).unwrap(), &config)
            .await
            .err()
            .unwrap();
        assert!(error.contains("token 验证失败"));
        assert!(!error.contains(&config.token));
        worker.join().unwrap();
    }

    #[tokio::test]
    async fn a_connected_bridge_without_a_canvas_is_waiting_not_ready() {
        for (snapshot, expected) in [
            (
                serde_json::json!({"ok":false,"error":"当前没有已连接画布"}),
                false,
            ),
            (
                serde_json::json!({"ok":true,"result":{"projectId":"test","title":"测试画布","nodes":[],"connections":[]}}),
                true,
            ),
        ] {
            let (url, worker) = mock_service(vec![
                (200, serde_json::json!({"ok":true,"protocolVersion":6})),
                (200, serde_json::json!({"ok":true})),
                (if expected { 200 } else { 500 }, snapshot),
            ]);
            let config = Config {
                url,
                token: "test".into(),
            };
            assert_eq!(
                read_status(&client(30_000).unwrap(), &config)
                    .await
                    .unwrap()
                    .ready,
                expected
            );
            worker.join().unwrap();
        }
    }

    #[tokio::test]
    async fn an_unused_port_is_distinct_from_an_unrelated_service() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        drop(listener);
        assert!(!health(&client(30_000).unwrap(), &url).await.unwrap());
        let (url, worker) = mock_service(vec![(404, serde_json::json!({"unrelated":true}))]);
        assert!(health(&client(30_000).unwrap(), &url)
            .await
            .unwrap_err()
            .contains("占用"));
        worker.join().unwrap();
    }

    #[test]
    fn bridge_credentials_only_open_on_our_site_and_stay_in_fragment() {
        let config = Config {
            url: "http://127.0.0.1:17371".into(),
            token: "a+b&c".into(),
        };
        let url = reqwest::Url::parse(&open_url(&config, true).unwrap()).unwrap();
        assert_eq!(url.host_str(), Some("huabu.jiucaihezi.studio"));
        assert_eq!(url.query(), Some("mode=new"));
        let fragment =
            reqwest::Url::parse(&format!("http://localhost?{}", url.fragment().unwrap())).unwrap();
        let values: HashMap<_, _> = fragment.query_pairs().into_owned().collect();
        assert_eq!(values["agentToken"], "a+b&c");
        assert_eq!(values["agentMode"], "tools");
        for bad in [
            "https://127.0.0.1",
            "http://example.com",
            "http://127.0.0.1/path",
            "http://u:p@localhost",
            "http://localhost?token=x",
        ] {
            assert!(validate_url(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn health_presence_does_not_prove_a_real_canvas_is_ready() {
        assert!(
            !status_from_snapshot(
                &serde_json::json!({"ok":true,"result":{"hasCanvas":false,"nodes":[]}})
            )
            .ready
        );
        assert!(
            !status_from_snapshot(&serde_json::json!({"ok":true,"result":{"projectId":"p"}})).ready
        );
        assert!(status_from_snapshot(&serde_json::json!({"ok":true,"result":{"projectId":"p","title":"test","nodes":[],"connections":[]}})).ready);
    }

    #[test]
    fn another_window_keeps_its_lease_and_external_services_have_no_handle_to_kill() {
        let mut bridge = Bridge::default();
        bridge.leases.insert(
            "first".into(),
            Owner {
                window: "a".into(),
                realm: "r".into(),
            },
        );
        bridge.leases.insert(
            "second".into(),
            Owner {
                window: "b".into(),
                realm: "r".into(),
            },
        );
        bridge.leases.retain(|_, owner| owner.window != "a");
        stop_if_unused(&mut bridge);
        assert!(bridge.leases.contains_key("second"));
        bridge.leases.clear();
        stop_if_unused(&mut bridge);
        assert!(bridge.handle.is_none());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn owned_bridge_survives_one_window_and_is_killed_after_the_last_lease() {
        let mut command = tokio::process::Command::new("/bin/sleep");
        command
            .arg("30")
            .stdin(std::process::Stdio::piped())
            .process_group(0)
            .kill_on_drop(true);
        let mut child = command.spawn().unwrap();
        let pid = child.id().unwrap();
        let stdin = std::sync::Arc::new(tokio::sync::Mutex::new(child.stdin.take().unwrap()));
        let handle = format!("test-canvas-{}", uuid::Uuid::new_v4());
        lock_processes().insert(
            handle.clone(),
            super::super::McpStdioProcess {
                pid,
                child,
                stdin,
                is_harness_runner: false,
                owner: None,
            },
        );
        let mut bridge = Bridge {
            handle: Some(handle.clone()),
            leases: HashMap::new(),
        };
        bridge.leases.insert(
            "other-window".into(),
            Owner {
                window: "b".into(),
                realm: "r".into(),
            },
        );
        stop_if_unused(&mut bridge);
        assert!(lock_processes().contains_key(&handle));
        bridge.leases.clear();
        stop_if_unused(&mut bridge);
        assert!(!lock_processes().contains_key(&handle));
        assert!(bridge.handle.is_none());
    }
}

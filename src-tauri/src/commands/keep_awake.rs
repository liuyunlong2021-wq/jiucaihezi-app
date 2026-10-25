//! 手机控制器开着时，电脑不因闲置自动睡眠（屏幕照常熄灭，合盖仍会睡）。
//!
//! 守卫在就阻止闲置睡眠，守卫放下就恢复。macOS 用系统自带 `caffeinate -i -w <本进程>`：
//! 本进程退出或崩溃它也随之结束，不会留下让电脑一直醒着的残留进程。

/// 持有期间阻止闲置睡眠。
pub struct KeepAwake {
    #[cfg(target_os = "macos")]
    child: std::process::Child,
    /// Windows 的执行状态按线程生效：专门一条线程设好后等着，放下时让它复位退出。
    #[cfg(windows)]
    release: Option<std::sync::mpsc::Sender<()>>,
}

/// `-i` 只挡闲置睡眠（不挡屏幕熄灭）；`-w` 跟着本进程，进程没了它就退出。
#[cfg(target_os = "macos")]
fn caffeinate_args(pid: u32) -> Vec<String> {
    vec!["-i".into(), "-w".into(), pid.to_string()]
}

#[cfg(target_os = "macos")]
pub fn hold() -> Result<KeepAwake, String> {
    let child = std::process::Command::new("/usr/bin/caffeinate")
        .args(caffeinate_args(std::process::id()))
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|error| format!("无法阻止电脑睡眠: {error}"))?;
    Ok(KeepAwake { child })
}

#[cfg(windows)]
pub fn hold() -> Result<KeepAwake, String> {
    use windows_sys::Win32::System::Power::{
        ES_CONTINUOUS, ES_SYSTEM_REQUIRED, SetThreadExecutionState,
    };
    let (release, wait) = std::sync::mpsc::channel::<()>();
    std::thread::spawn(move || {
        unsafe { SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED) };
        let _ = wait.recv();
        unsafe { SetThreadExecutionState(ES_CONTINUOUS) };
    });
    Ok(KeepAwake {
        release: Some(release),
    })
}

#[cfg(not(any(target_os = "macos", windows)))]
pub fn hold() -> Result<KeepAwake, String> {
    Ok(KeepAwake {})
}

impl Drop for KeepAwake {
    fn drop(&mut self) {
        #[cfg(target_os = "macos")]
        {
            let _ = self.child.kill();
            let _ = self.child.wait();
        }
        #[cfg(windows)]
        if let Some(release) = self.release.take() {
            let _ = release.send(());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(target_os = "macos")]
    fn caffeinate_running_for(pid: u32) -> bool {
        let output = std::process::Command::new("pgrep")
            .args(["-f", &format!("caffeinate -i -w {pid}")])
            .output()
            .unwrap();
        output.status.success()
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn caffeinate_only_blocks_idle_sleep_and_follows_this_process() {
        assert_eq!(caffeinate_args(42), vec!["-i", "-w", "42"]);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn holding_keeps_the_mac_awake_and_dropping_releases_it() {
        let pid = std::process::id();
        let guard = hold().expect("应能阻止闲置睡眠");
        assert!(caffeinate_running_for(pid), "持有时 caffeinate 在跑");
        drop(guard);
        std::thread::sleep(std::time::Duration::from_millis(300));
        assert!(!caffeinate_running_for(pid), "放下后不留残留进程");
    }
}

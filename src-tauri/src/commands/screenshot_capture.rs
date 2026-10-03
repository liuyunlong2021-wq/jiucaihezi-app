#[cfg(target_os = "macos")]
use std::io::Cursor;
use tauri::Monitor;

// ponytail: 一个目标屏最大 256 MiB RGBA；更大屏需要调整资源预算，不无限解码。
pub const MAX_RGBA: usize = 256 * 1024 * 1024;
pub struct Frame {
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,
}
impl Frame {
    pub fn validate(&self) -> Result<(), String> {
        let size = (self.width as usize)
            .checked_mul(self.height as usize)
            .and_then(|n| n.checked_mul(4));
        if self.width == 0
            || self.height == 0
            || size != Some(self.rgba.len())
            || self.rgba.len() > MAX_RGBA
        {
            return Err("截图尺寸或数据无效（单屏上限 256 MiB）".into());
        }
        Ok(())
    }
    pub fn png(&self) -> Result<Vec<u8>, String> {
        self.validate()?;
        let mut bytes = Vec::new();
        let mut encoder = png::Encoder::new(&mut bytes, self.width, self.height);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        encoder
            .write_header()
            .map_err(|e| e.to_string())?
            .write_image_data(&self.rgba)
            .map_err(|e| e.to_string())?;
        Ok(bytes)
    }
    pub fn crop(&self, [x, y, w, h]: [u32; 4]) -> Self {
        let mut rgba = Vec::with_capacity(w as usize * h as usize * 4);
        for row in y..y + h {
            let start = (row as usize * self.width as usize + x as usize) * 4;
            rgba.extend_from_slice(&self.rgba[start..start + w as usize * 4]);
        }
        Self {
            width: w,
            height: h,
            rgba,
        }
    }
}

#[cfg(target_os = "windows")]
pub fn capture(monitor: &Monitor) -> Result<Frame, String> {
    // Windows 使用物理桌面坐标；匹配 Tauri 选中的同一屏。
    let target = xcap::Monitor::all()
        .map_err(|e| e.to_string())?
        .into_iter()
        .find(|m| {
            m.x().ok() == Some(monitor.position().x) && m.y().ok() == Some(monitor.position().y)
        })
        .ok_or("目标显示器已拔出")?;
    let size = (target.width().map_err(|e| e.to_string())? as usize)
        .checked_mul(target.height().map_err(|e| e.to_string())? as usize)
        .and_then(|n| n.checked_mul(4));
    if size.is_none_or(|n| n > MAX_RGBA) {
        return Err("目标屏幕超过 256 MiB 捕获上限".into());
    }
    let image = target.capture_image().map_err(|e| e.to_string())?;
    let frame = Frame {
        width: image.width(),
        height: image.height(),
        rgba: image.into_raw(),
    };
    frame.validate()?;
    Ok(frame)
}

#[cfg(target_os = "macos")]
#[repr(C)]
#[derive(Clone, Copy)]
struct Point {
    x: f64,
    y: f64,
}
#[cfg(target_os = "macos")]
#[repr(C)]
#[derive(Clone, Copy)]
struct Size {
    width: f64,
    height: f64,
}
#[cfg(target_os = "macos")]
#[repr(C)]
struct Rect {
    origin: Point,
    size: Size,
}
#[cfg(target_os = "macos")]
#[link(name = "CoreGraphics", kind = "framework")]
unsafe extern "C" {
    fn CGPreflightScreenCaptureAccess() -> bool;
    fn CGRequestScreenCaptureAccess() -> bool;
    fn CGGetActiveDisplayList(max: u32, displays: *mut u32, count: *mut u32) -> i32;
    fn CGMainDisplayID() -> u32;
    fn CGDisplayBounds(id: u32) -> Rect;
    fn CGEventCreate(source: *const std::ffi::c_void) -> *const std::ffi::c_void;
    fn CGEventGetLocation(event: *const std::ffi::c_void) -> Point;
}
#[cfg(target_os = "macos")]
#[link(name = "CoreFoundation", kind = "framework")]
unsafe extern "C" {
    fn CFRelease(value: *const std::ffi::c_void);
}

pub fn permission(request: bool) -> bool {
    #[cfg(target_os = "macos")]
    unsafe {
        if request {
            CGRequestScreenCaptureAccess()
        } else {
            CGPreflightScreenCaptureAccess()
        }
    }
    #[cfg(target_os = "windows")]
    {
        let _ = request;
        true
    }
}

pub fn target_monitor(app: &tauri::AppHandle) -> Result<Monitor, String> {
    #[cfg(target_os = "windows")]
    let point = app.cursor_position().map_err(|e| e.to_string())?;
    // Tao 的 macOS monitor_from_point 实际接受 CoreGraphics 逻辑坐标，不能把物理鼠标坐标直接传进去。
    #[cfg(target_os = "macos")]
    let point = unsafe {
        let event = CGEventCreate(std::ptr::null());
        if event.is_null() {
            return Err("无法读取鼠标位置".into());
        }
        let point = CGEventGetLocation(event);
        CFRelease(event);
        point
    };
    app.monitor_from_point(point.x, point.y)
        .map_err(|e| e.to_string())?
        .ok_or("鼠标不在可用显示器上".into())
}

#[cfg(target_os = "macos")]
pub fn capture(monitor: &Monitor) -> Result<Frame, String> {
    use std::{
        fs,
        process::{Command, Stdio},
        time::{Duration, Instant},
    };
    if !permission(false) {
        return Err(
            "请在系统设置 → 隐私与安全性 → 屏幕录制中授权韭菜盒子；授权后如仍失败，请重启应用"
                .into(),
        );
    }
    let scale = monitor.scale_factor();
    let position = monitor.position().to_logical::<f64>(scale);
    let size = monitor.size().to_logical::<f64>(scale);
    let mut ids = [0u32; 32];
    let mut count = 0;
    let index = unsafe {
        if CGGetActiveDisplayList(32, ids.as_mut_ptr(), &mut count) != 0 {
            return Err("无法枚举显示器".into());
        }
        let ids = &mut ids[..count as usize];
        let main = CGMainDisplayID();
        if let Some(i) = ids.iter().position(|id| *id == main) {
            ids.swap(0, i);
        }
        ids.iter()
            .position(|id| {
                let b = CGDisplayBounds(*id);
                (b.origin.x - position.x).abs() < 1.
                    && (b.origin.y - position.y).abs() < 1.
                    && (b.size.width - size.width).abs() < 1.
                    && (b.size.height - size.height).abs() < 1.
            })
            .ok_or("目标显示器映射失败，请重新截图")?
            + 1
    };
    let path = std::env::temp_dir().join(format!("jc-shot-{}.png", uuid::Uuid::new_v4()));
    let result = (|| {
        let mut child = Command::new("/usr/sbin/screencapture")
            .args(["-x", "-D", &index.to_string(), "-t", "png"])
            .arg(&path)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| e.to_string())?;
        let start = Instant::now();
        let status = loop {
            match child.try_wait() {
                Ok(Some(status)) => break status,
                Ok(None) => {}
                Err(error) => {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(error.to_string());
                }
            }
            if start.elapsed() > Duration::from_secs(15) {
                let _ = child.kill();
                let _ = child.wait();
                return Err("系统截图超时".into());
            }
            std::thread::sleep(Duration::from_millis(25));
        };
        if !status.success() {
            return Err("系统截图失败，请检查屏幕录制权限".into());
        }
        if fs::metadata(&path).map_err(|e| e.to_string())?.len() > MAX_RGBA as u64 {
            return Err("截图文件过大".into());
        }
        let bytes = fs::read(&path).map_err(|e| e.to_string())?;
        let mut decoder = png::Decoder::new(Cursor::new(bytes));
        decoder.set_limits(png::Limits { bytes: MAX_RGBA });
        decoder.set_transformations(png::Transformations::EXPAND | png::Transformations::STRIP_16);
        let mut reader = decoder.read_info().map_err(|e| e.to_string())?;
        if reader.output_buffer_size() > MAX_RGBA {
            return Err("截图解码尺寸过大".into());
        }
        let pixels = reader.info();
        if (pixels.width as usize)
            .checked_mul(pixels.height as usize)
            .and_then(|n| n.checked_mul(4))
            .is_none_or(|n| n > MAX_RGBA)
        {
            return Err("截图 RGBA 尺寸过大".into());
        }
        let mut bytes = vec![0; reader.output_buffer_size()];
        let info = reader.next_frame(&mut bytes).map_err(|e| e.to_string())?;
        let mut rgba = Vec::new();
        match info.color_type {
            png::ColorType::Rgba => rgba.extend_from_slice(&bytes[..info.buffer_size()]),
            png::ColorType::Rgb => {
                for pixel in bytes[..info.buffer_size()].chunks_exact(3) {
                    rgba.extend_from_slice(&[pixel[0], pixel[1], pixel[2], 255]);
                }
            }
            _ => return Err("系统返回了不支持的截图格式".into()),
        }
        let frame = Frame {
            width: info.width,
            height: info.height,
            rgba,
        };
        frame.validate()?;
        Ok(frame)
    })();
    let _ = fs::remove_file(path);
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn png_and_crop_preserve_exact_pixels() {
        let frame = Frame {
            width: 3,
            height: 2,
            rgba: (0..24).collect(),
        };
        let cropped = frame.crop([1, 0, 2, 2]);
        assert_eq!(
            cropped.rgba,
            [&frame.rgba[4..12], &frame.rgba[16..24]].concat()
        );
        let bytes = cropped.png().unwrap();
        let mut reader = png::Decoder::new(std::io::Cursor::new(bytes))
            .read_info()
            .unwrap();
        let mut output = vec![0; reader.output_buffer_size()];
        let info = reader.next_frame(&mut output).unwrap();
        assert_eq!((info.width, info.height), (2, 2));
        assert_eq!(&output[..info.buffer_size()], cropped.rgba.as_slice());
        assert!(
            Frame {
                width: 2,
                height: 2,
                rgba: vec![0; 3]
            }
            .png()
            .is_err()
        );
    }
}

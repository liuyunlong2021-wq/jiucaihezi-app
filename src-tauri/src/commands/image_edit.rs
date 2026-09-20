//! 画布图像擦除：vendored `HealPixels.c`（MIT, Wonder Assembly LLC）的薄封装。
//!
//! 只处理调用方裁好的局部像素块，算法只改选区矩形内的像素，矩形外一个字节都不动，
//! 因此前端把返回结果贴回原图不会有接缝。
//!
//! 设计决策、实测数据与未验证边界见
//! `docs/wiki/开发/画布图像擦除能力SDD-2026-09-19.md`。

use base64::Engine as _;
use serde::{Deserialize, Serialize};

/// RGBA 单块像素上限（256 MB），挡住异常入参把进程打爆。
const MAX_PIXELS: usize = 64 * 1024 * 1024;

/// `spot_heal` 的固定随机种子：让同一次擦除可复现，方便排查和测试。
const HEAL_SEED: u32 = 0x6d2b79f5;

unsafe extern "C" {
    /// 见 `vendor/compositor-heal/HealPixels.h`。
    /// 就地修改 `rgba` 中 coverage 非零的像素；mode 0=内容感知 1=生成纹理 2=邻近匹配。
    fn spot_heal(
        rgba: *mut u8,
        coverage: *const u8,
        width: usize,
        height: usize,
        stride: usize,
        opacity: f32,
        mode: i32,
        seed: u32,
    ) -> i32;
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EraseImageRegionInput {
    /// 局部像素块的 premultiplied RGBA，base64。
    pub pixels_base64: String,
    pub width: u32,
    pub height: u32,
    /// 要擦除的矩形，坐标相对传入的像素块（不是原图）。
    pub rect_x: i32,
    pub rect_y: i32,
    pub rect_width: i32,
    pub rect_height: i32,
    /// 0 内容感知 / 1 生成纹理 / 2 邻近匹配。
    pub mode: i32,
    pub opacity: f32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EraseImageRegionOutput {
    pub pixels_base64: String,
}

#[tauri::command]
pub fn erase_image_region(
    input: EraseImageRegionInput,
) -> Result<EraseImageRegionOutput, String> {
    let width = input.width as usize;
    let height = input.height as usize;
    if width == 0 || height == 0 {
        return Err("擦除区域尺寸无效".into());
    }
    let pixels = width
        .checked_mul(height)
        .filter(|count| *count <= MAX_PIXELS)
        .ok_or("擦除区域过大")?;

    let mut rgba = base64::engine::general_purpose::STANDARD
        .decode(input.pixels_base64.as_bytes())
        .map_err(|_| "像素数据不是有效的 base64".to_string())?;
    if rgba.len() != pixels * 4 {
        return Err("像素数据长度与尺寸不匹配".into());
    }

    let mut coverage = vec![0u8; pixels];
    for y in input.rect_y.max(0)..(input.rect_y + input.rect_height).min(height as i32) {
        for x in input.rect_x.max(0)..(input.rect_x + input.rect_width).min(width as i32) {
            coverage[y as usize * width + x as usize] = 255;
        }
    }
    if coverage.iter().all(|value| *value == 0) {
        return Err("擦除区域超出图片范围".into());
    }

    let status = unsafe {
        spot_heal(
            rgba.as_mut_ptr(),
            coverage.as_ptr(),
            width,
            height,
            width * 4,
            input.opacity.clamp(0.0, 1.0),
            input.mode,
            HEAL_SEED,
        )
    };
    if status != 0 {
        return Err("擦除失败：内存不足".into());
    }

    Ok(EraseImageRegionOutput {
        pixels_base64: base64::engine::general_purpose::STANDARD.encode(&rgba),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 造一块「纯色背景 + 中间一个显眼色块」的小图，色块就是待擦的瑕疵。
    fn scene(width: u32, height: u32) -> Vec<u8> {
        let mut rgba = Vec::with_capacity((width * height * 4) as usize);
        for y in 0..height {
            for x in 0..width {
                let inside = (width / 4..width * 3 / 4).contains(&x)
                    && (height / 4..height * 3 / 4).contains(&y);
                let (r, g, b) = if inside { (255, 0, 0) } else { (200, 200, 200) };
                rgba.extend_from_slice(&[r, g, b, 255]);
            }
        }
        rgba
    }

    fn encode(rgba: &[u8]) -> String {
        base64::engine::general_purpose::STANDARD.encode(rgba)
    }

    #[test]
    fn erase_replaces_selected_pixels_with_surroundings() {
        let (width, height) = (32u32, 32u32);
        let before = scene(width, height);
        let output = erase_image_region(EraseImageRegionInput {
            pixels_base64: encode(&before),
            width,
            height,
            rect_x: width as i32 / 4,
            rect_y: height as i32 / 4,
            rect_width: width as i32 / 2,
            rect_height: height as i32 / 2,
            mode: 0,
            opacity: 1.0,
        })
        .expect("擦除应成功");
        let after = base64::engine::general_purpose::STANDARD
            .decode(output.pixels_base64)
            .expect("输出应是有效 base64");

        assert_eq!(after.len(), before.len(), "输出尺寸应保持不变");

        // 选区内不再是纯红：被周围灰色填充接管。
        let center = ((height / 2 * width + width / 2) * 4) as usize;
        assert!(
            after[center] < 250 || after[center + 1] > 5,
            "选区中心仍是被擦掉前的红色 {:?}",
            &after[center..center + 3]
        );

        // 选区外一个像素都不能变。
        let mut changed_outside = 0;
        for y in 0..height {
            for x in 0..width {
                let inside = (width / 4..width * 3 / 4).contains(&x)
                    && (height / 4..height * 3 / 4).contains(&y);
                if inside {
                    continue;
                }
                let offset = ((y * width + x) * 4) as usize;
                if after[offset..offset + 4] != before[offset..offset + 4] {
                    changed_outside += 1;
                }
            }
        }
        assert_eq!(changed_outside, 0, "选区外像素不应被改动");
    }

    #[test]
    fn rejects_mismatched_pixel_length() {
        let result = erase_image_region(EraseImageRegionInput {
            pixels_base64: encode(&[0, 0, 0, 255]),
            width: 4,
            height: 4,
            rect_x: 0,
            rect_y: 0,
            rect_width: 2,
            rect_height: 2,
            mode: 0,
            opacity: 1.0,
        });
        assert!(result.is_err(), "长度不匹配应被拒绝");
    }

    /// Tauri 会把前端 JSON 载荷按参数名映射成 Rust 参数。
    /// 锁住字段名映射：前端 camelCase 一旦和 Rust 的 snake_case 对不上，先在这里炸。
    #[test]
    fn accepts_the_frontend_payload_shape() {
        #[derive(Deserialize)]
        struct InvokeArgs {
            input: EraseImageRegionInput,
        }
        let payload = r#"{"input":{"pixelsBase64":"AAAAAA==","width":1,"height":1,"rectX":0,"rectY":0,"rectWidth":1,"rectHeight":1,"mode":0,"opacity":1}}"#;
        let args: InvokeArgs = serde_json::from_str(payload).expect("前端载荷应能反序列化");
        assert_eq!(args.input.pixels_base64, "AAAAAA==");
        assert_eq!(args.input.rect_width, 1);
        assert_eq!(args.input.rect_height, 1);
        assert_eq!(args.input.opacity, 1.0);
    }

    #[test]
    fn rejects_rect_outside_image() {
        let result = erase_image_region(EraseImageRegionInput {
            pixels_base64: encode(&scene(8, 8)),
            width: 8,
            height: 8,
            rect_x: 100,
            rect_y: 100,
            rect_width: 4,
            rect_height: 4,
            mode: 0,
            opacity: 1.0,
        });
        assert!(result.is_err(), "越界选区应被拒绝");
    }

    /// 前端的真实用法是只把「选区外扩 64」的小块传进来（IPC 传输量），而不是整图。
    /// 这个测试守住那条底线：裁小了之后瑕疵照样擦得掉。
    #[test]
    fn cropped_region_still_erases_the_blemish() {
        let (width, height) = (256u32, 256u32);
        // 水平渐变的干净背景，中间放一块高对比红块 —— 相当于图上一段要去掉的文字。
        const BLEMISH: u32 = 40;
        const MARGIN: u32 = 64;
        let blemish_start = 108u32;
        let mut scene = Vec::with_capacity((width * height * 4) as usize);
        for y in 0..height {
            for x in 0..width {
                let blemish = (blemish_start..blemish_start + BLEMISH).contains(&x)
                    && (blemish_start..blemish_start + BLEMISH).contains(&y);
                let (r, g, b) = if blemish {
                    (230, 30, 30)
                } else {
                    (180 + (x / 8) as u8, 190, 200)
                };
                scene.extend_from_slice(&[r, g, b, 255]);
            }
        }

        let side = BLEMISH + MARGIN * 2;
        let (x0, y0) = (blemish_start - MARGIN, blemish_start - MARGIN);
        let mut block = Vec::with_capacity((side * side * 4) as usize);
        for y in 0..side {
            for x in 0..side {
                let offset = (((y0 + y) * width + (x0 + x)) * 4) as usize;
                block.extend_from_slice(&scene[offset..offset + 4]);
            }
        }

        let output = erase_image_region(EraseImageRegionInput {
            pixels_base64: encode(&block),
            width: side,
            height: side,
            rect_x: MARGIN as i32,
            rect_y: MARGIN as i32,
            rect_width: BLEMISH as i32,
            rect_height: BLEMISH as i32,
            mode: 0,
            opacity: 1.0,
        })
        .expect("裁剪块擦除应成功");
        let after = base64::engine::general_purpose::STANDARD
            .decode(output.pixels_base64)
            .expect("输出应是有效 base64");

        assert_eq!(after.len(), block.len(), "输出尺寸应保持不变");

        // 中心绿通道：红块 30，渐变背景 190。擦干净了就该回到背景那一档。
        let center = (((side / 2) * side + side / 2) * 4) as usize;
        assert!(
            after[center + 1] > 120,
            "裁剪后中心仍是红块，绿通道只有 {}",
            after[center + 1]
        );
    }
}

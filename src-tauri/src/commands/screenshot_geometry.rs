pub fn crop_bounds(width: u32, height: u32, rect: [f64; 6]) -> Result<[u32; 4], String> {
    let [x1, y1, x2, y2, css_width, css_height] = rect;
    if rect.iter().any(|n| !n.is_finite())
        || css_width <= 0.
        || css_height <= 0.
        || width == 0
        || height == 0
    {
        return Err("选区坐标无效".into());
    }
    let sx = f64::from(width) / css_width;
    let sy = f64::from(height) / css_height;
    let left = (x1.min(x2) * sx).floor().clamp(0., f64::from(width)) as u32;
    let top = (y1.min(y2) * sy).floor().clamp(0., f64::from(height)) as u32;
    let right = (x1.max(x2) * sx).ceil().clamp(0., f64::from(width)) as u32;
    let bottom = (y1.max(y2) * sy).ceil().clamp(0., f64::from(height)) as u32;
    if right - left < 2 || bottom - top < 2 {
        return Err("选区至少需要 2×2 像素".into());
    }
    Ok([left, top, right - left, bottom - top])
}

pub fn check_task(id: &str, label: &str, requested_id: &str, caller: &str) -> Result<(), String> {
    if id != requested_id || label != caller {
        return Err("截图任务已结束或不属于此窗口".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reverse_drag_rounds_and_clamps_physical_pixels() {
        assert_eq!(
            crop_bounds(200, 150, [99.8, 74.7, -4.0, 1.2, 100.0, 75.0]).unwrap(),
            [0, 2, 200, 148]
        );
        assert_eq!(
            crop_bounds(200, 150, [10.0, 20.0, 30.0, 40.0, 100.0, 75.0]).unwrap(),
            [20, 40, 40, 40]
        );
    }
    #[test]
    fn rejects_invalid_and_tiny_selection() {
        for rect in [
            [0., 0., 1., 1., 0., 100.],
            [0., 0., 0., 0., 100., 100.],
            [f64::NAN, 0., 10., 10., 100., 100.],
            [0., 0., 0.2, 0.2, 100., 100.],
        ] {
            assert!(crop_bounds(100, 100, rect).is_err());
        }
    }
    #[test]
    fn stale_or_foreign_task_cannot_access_capture() {
        assert!(check_task("one", "shot-one", "one", "shot-one").is_ok());
        assert!(check_task("one", "shot-one", "two", "shot-one").is_err());
        assert!(check_task("one", "shot-one", "one", "main").is_err());
    }
}

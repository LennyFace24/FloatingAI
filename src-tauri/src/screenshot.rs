use base64::Engine;
use image::ImageEncoder;

/// 截取屏幕全局坐标 (x, y) 处 w×h 区域，返回 `data:image/png;base64,...` data URI。
/// 跨平台：Windows / macOS / Linux 均经 xcap 实现。
#[tauri::command]
pub async fn capture_screen_region(
    x: i32,
    y: i32,
    width: u32,
    height: u32,
) -> Result<String, String> {
    if width == 0 || height == 0 {
        return Err("截图区域为空".to_string());
    }

    let monitor = xcap::Monitor::from_point(x, y).map_err(|error| format!("找不到屏幕：{error}"))?;
    // xcap 的 capture_region 坐标相对该 monitor 左上角，需换算
    let monitor_x = monitor.x().map_err(|error| format!("读取屏幕坐标失败：{error}"))?;
    let monitor_y = monitor.y().map_err(|error| format!("读取屏幕坐标失败：{error}"))?;
    let rel_x = (x - monitor_x).max(0) as u32;
    let rel_y = (y - monitor_y).max(0) as u32;

    let image = monitor
        .capture_region(rel_x, rel_y, width, height)
        .map_err(|error| format!("截图失败：{error}"))?;

    let mut png: Vec<u8> = Vec::new();
    image::codecs::png::PngEncoder::new(&mut png)
        .write_image(
            image.as_raw(),
            image.width(),
            image.height(),
            image::ExtendedColorType::Rgba8,
        )
        .map_err(|error| format!("编码截图失败：{error}"))?;

    Ok(format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(png)
    ))
}

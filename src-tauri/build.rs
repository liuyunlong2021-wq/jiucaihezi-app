fn main() {
    // ponytail: 只有一个 C 文件，用 cc crate 默认行为即可，不写自定义链接逻辑。
    cc::Build::new()
        .file("vendor/compositor-heal/HealPixels.c")
        .warnings(false)
        .compile("compositor_heal");
    println!("cargo:rerun-if-changed=vendor/compositor-heal/HealPixels.c");
    tauri_build::build()
}

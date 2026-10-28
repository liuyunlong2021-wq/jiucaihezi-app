# Local compatibility patch

Source: crates.io `swift-rs 1.0.8` (MIT OR Apache-2.0).

For Xcode 27+ iOS Release only, pass `--build-system native` to SwiftPM. The default Swift Build backend emits internal `@_cdecl` entry points as local symbols, so Rust cannot link Tauri or its plugins. Debug, macOS and other targets retain upstream behavior.

Evidence: https://github.com/tauri-apps/tauri/issues/16130 and local Release link failure with `nm` showing lowercase `t` for `_register_plugin` / `_retain_object`. Remove this patch when upstream globally exports the affected entry points. Native SwiftPM is deprecated, so this is a temporary toolchain compatibility fix.

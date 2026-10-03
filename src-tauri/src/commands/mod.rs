pub mod clipboard;
pub mod creation_mcp;
pub mod dev;
pub mod greet;
pub mod http;
pub mod image_edit;
pub mod mcp;
pub mod media;
pub mod plugin;
pub mod remote_bridge;
pub mod remote_client;
pub mod session;
pub mod skill_material;
pub mod tools;
pub mod workspace;

#[cfg(any(target_os = "windows", target_os = "macos"))]
pub mod screenshot;
#[cfg(any(target_os = "windows", target_os = "macos"))]
pub mod screenshot_capture;
#[cfg(any(target_os = "windows", target_os = "macos"))]
pub mod screenshot_geometry;

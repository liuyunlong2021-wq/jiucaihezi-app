pub mod agents;
pub mod collections;
pub mod db;
pub mod discover;
pub mod github_import;
pub mod linker;
pub mod marketplace;
pub mod path_utils;
pub mod scanner;
pub mod settings;
pub mod skills;

use std::path::PathBuf;

pub struct SkillsAppState {
    pub db: db::DbPool,
    /// 内置预设 Skill 源目录（public/skills/ 或资源目录），用于 scan 前自动播种
    pub preset_skills_src: Option<PathBuf>,
}

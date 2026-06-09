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

pub struct SkillsAppState {
    pub db: db::DbPool,
}

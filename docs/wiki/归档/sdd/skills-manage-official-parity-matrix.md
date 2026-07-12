# Skills Manage Official Parity Matrix

This matrix records the upstream `skills-manage` baseline used by the embedded Jiucaihezi Skill Manage implementation.

## Official Baseline

| Field | Value |
| --- | --- |
| Repository | `https://github.com/iamzhihuix/skills-manage` |
| Branch | `main` |
| Commit | `467d0423beaf71a31c520d4e3795ec88acae5ab2` |
| Commit date | `2026-05-02T14:00:37Z` |
| Commit message | `docs: add Discord community link` |
| Audit script | `scripts/audit-skills-manage-parity.mjs` |

## Audit Scope

| Area | Official source | Jiucaihezi source | Policy |
| --- | --- | --- | --- |
| Tauri commands | `src-tauri/src/lib.rs` generate handler | `src-tauri/src/lib.rs` `skills::...` entries | Required official command names must be present. Host-only extra commands are allowed only outside Skill Manage scope. |
| Rust modules | `src-tauri/src/commands/*.rs`, `db.rs`, `path_utils.rs` | `src-tauri/src/skills/*.rs` | Required module counterparts must exist. Jiucaihezi may split host-specific helpers into extra files. |
| TypeScript types | `src/types/index.ts` | `src/types/skillsManage.ts` | Required interface fields must exist. Extra host fields are allowed. |
| i18n keys / terms | `src/i18n/locales/en.json`, `src/i18n/locales/zh.json` | `src/i18n/index.ts`, `src/components/skills/**` | Official product terms must remain visible exactly where they are product nouns; current host UI does not mirror official i18next key structure. |

## Known Intentional Deltas

| Area | Delta | Reason |
| --- | --- | --- |
| Command namespace | Official uses `commands::<module>::...`; Jiucaihezi uses `skills::<module>::...` | Embedded Tauri module is namespaced under the host application. |
| Agent semantics | Jiucaihezi adds `uses_central_root` and `is_install_target` to `AgentWithStatus` | Prevents frontend path guessing and makes Platform install targets backend-owned. |
| File IPC | Jiucaihezi adds `SkillFileAccessContext` to path-reading commands | Host app requires narrower filesystem access than the standalone official app. |
| Settings | Jiucaihezi adds `get_skills_database_path` | UI Settings parity exposes the embedded database path. |
| UI alias | Jiucaihezi stores display aliases in frontend localStorage only | Alias is UI-only metadata and must not affect official Skill behavior. |
| i18n structure | Official uses React/i18next JSON locale keys; Jiucaihezi uses host i18n plus Vue component text | Audit checks required official terms instead of requiring identical locale key paths. |

## Current Required Command Baseline

The audit script checks the official command names from commit `467d0423beaf71a31c520d4e3795ec88acae5ab2`, including:

`scan_all_skills`, `get_agents`, `detect_agents`, `add_custom_agent`, `update_custom_agent`, `remove_custom_agent`, `install_skill_to_agent`, `uninstall_skill_from_agent`, `batch_install_to_agents`, `get_skills_by_agent`, `get_central_skills`, `get_central_skill_bundles`, `get_central_skill_bundle_detail`, `preview_delete_central_skill_bundle`, `delete_central_skill_bundle`, `delete_central_skill`, `get_skill_detail`, `read_skill_content`, `read_file_by_path`, `list_skill_directory`, `open_in_file_manager`, `create_collection`, `get_collections`, `get_collection_detail`, `add_skill_to_collection`, `remove_skill_from_collection`, `delete_collection`, `update_collection`, `batch_install_collection`, `export_collection`, `import_collection`, `get_scan_directories`, `add_scan_directory`, `remove_scan_directory`, `set_scan_directory_active`, `get_setting`, `set_setting`, `discover_scan_roots`, `get_scan_roots`, `get_obsidian_vaults`, `get_obsidian_vault_skills`, `set_scan_root_enabled`, `start_project_scan`, `stop_project_scan`, `get_discovered_skills`, `import_discovered_skill_to_central`, `import_discovered_skill_to_platform`, `clear_discovered_skills`, `preview_github_repo_import`, `import_github_repo_skills`, `fetch_github_skill_markdown`, `list_registries`, `add_registry`, `remove_registry`, `sync_registry`, `sync_registry_with_options`, `search_marketplace_skills`, `install_marketplace_skill`, `explain_skill`, `get_skill_explanation`, `explain_skill_stream`, `refresh_skill_explanation`.

## Update Procedure

1. Fetch the latest official `main` commit and update the baseline table above.
2. Update `OFFICIAL_BASELINE` in `scripts/audit-skills-manage-parity.mjs`.
3. Run `node scripts/audit-skills-manage-parity.mjs`.
4. Review any missing commands, modules, type fields, or i18n term warnings before porting new upstream behavior.

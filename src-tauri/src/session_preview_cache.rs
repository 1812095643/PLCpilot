use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, OnceLock},
    time::SystemTime,
};

use walkdir::WalkDir;

use crate::{parse_session_record, parse_session_record_with_mode, SessionRecord};

#[derive(Clone, Copy, PartialEq, Eq)]
struct FileStamp {
    modified: SystemTime,
    size: u64,
}

impl FileStamp {
    fn read(path: &Path) -> Option<Self> {
        let metadata = fs::metadata(path).ok()?;
        Some(Self {
            modified: metadata.modified().ok()?,
            size: metadata.len(),
        })
    }
}

struct CachedPreview {
    stamp: FileStamp,
    record: SessionRecord,
}

struct CachedSearch {
    stamp: FileStamp,
    archived: bool,
    record: SessionRecord,
    haystack: String,
}

#[derive(Default)]
struct SessionPreviewCache {
    entries: Mutex<HashMap<PathBuf, CachedPreview>>,
    search: Mutex<HashMap<PathBuf, Arc<CachedSearch>>>,
}

impl SessionPreviewCache {
    fn read_with(
        &self,
        path: &Path,
        parse: impl FnOnce(&Path) -> Option<SessionRecord>,
    ) -> Option<SessionRecord> {
        let stamp = FileStamp::read(path);
        if let Some(stamp) = stamp {
            let entries = self
                .entries
                .lock()
                .unwrap_or_else(|error| error.into_inner());
            if let Some(cached) = entries.get(path).filter(|cached| cached.stamp == stamp) {
                return Some(cached.record.clone());
            }
        }

        // 解析文件不占用缓存锁，避免多个窗口刷新时互相等待磁盘读取。
        let record = parse(path);
        let stable = stamp.is_some() && FileStamp::read(path) == stamp;
        let mut entries = self
            .entries
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        if let (Some(stamp), Some(record), true) = (stamp, record.as_ref(), stable) {
            entries.insert(
                path.to_path_buf(),
                CachedPreview {
                    stamp,
                    record: record.clone(),
                },
            );
        } else {
            // 写入中的文件不能作为稳定快照；下次刷新必须重新读取。
            entries.remove(path);
        }
        record
    }

    fn list_roots(&self, roots: &[(&Path, bool)]) -> Vec<SessionRecord> {
        let mut records = Vec::new();
        let mut paths = HashSet::new();
        // 保留原有目录深度和符号链接规则；删除的会话也从缓存中释放。
        for (root, archived) in roots {
            for entry in WalkDir::new(root)
                .max_depth(3)
                .follow_links(false)
                .into_iter()
                .filter_map(Result::ok)
            {
                let path = entry.path();
                if !entry.file_type().is_file()
                    || path.extension().and_then(|value| value.to_str()) != Some("jsonl")
                {
                    continue;
                }
                paths.insert(path.to_path_buf());
                if let Some(mut record) = self.read_with(path, parse_session_record) {
                    record.archived = *archived;
                    records.push(record);
                }
            }
        }
        self.entries
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .retain(|path, _| paths.contains(path));
        records.sort_by(|a, b| b.modified_at.cmp(&a.modified_at));
        records
    }

    fn list(&self, root: &Path) -> Vec<SessionRecord> {
        self.list_roots(&[(root, false)])
    }

    fn list_with_archived(&self, root: &Path, archived_root: &Path) -> Vec<SessionRecord> {
        self.list_roots(&[(root, false), (archived_root, true)])
    }

    fn search_with_archived(&self, root: &Path, archived_root: &Path, query: &str) -> Vec<SessionRecord> {
        let needle = query.trim().to_lowercase();
        if needle.is_empty() { return self.list_with_archived(root, archived_root); }
        let mut records = Vec::new();
        let mut paths = HashSet::new();
        for (scan_root, archived) in [(root, false), (archived_root, true)] {
            for entry in WalkDir::new(scan_root)
                .max_depth(3)
                .follow_links(false)
                .into_iter()
                .filter_map(Result::ok)
            {
                let path = entry.path();
                if !entry.file_type().is_file() || path.extension().and_then(|value| value.to_str()) != Some("jsonl") { continue; }
                let Some(stamp) = FileStamp::read(path) else { continue; };
                paths.insert(path.to_path_buf());
                let cached = {
                    let index = self.search.lock().unwrap_or_else(|error| error.into_inner());
                    index.get(path).filter(|item| item.stamp == stamp && item.archived == archived).cloned()
                };
                let cached = if let Some(cached) = cached {
                    cached
                } else {
                    // 全文只在文件变化后索引；不能用截断的预览，否则早期轮次和长消息无法检索。
                    let Some(mut record) = parse_session_record_with_mode(path, false) else { continue; };
                    let haystack = format!("{}\n{}\n{}\n{}", record.name.clone().unwrap_or_default(), record.cwd.clone().unwrap_or_default(), record.messages.iter().map(|message| message.content.as_str()).collect::<Vec<_>>().join("\n"), record.notes.iter().map(|note| note.content.as_str()).collect::<Vec<_>>().join("\n")).to_lowercase();
                    // 返回轻量列表，不在每次按键时复制附件、工具详情和整份全文。
                    let excess = record.messages.len().saturating_sub(crate::MAX_SESSION_PREVIEW_MESSAGES);
                    record.messages.drain(..excess);
                    for message in &mut record.messages {
                        message.content = crate::truncate(&message.content, crate::MAX_SESSION_PREVIEW_CHARS);
                        message.images.clear();
                        message.references.clear();
                        message.response_annotations.clear();
                    }
                    for note in &mut record.notes { note.content = crate::truncate(&note.content, 2000); }
                    record.ui_turns.clear();
                    record.activities.clear();
                    record.turn_durations.clear();
                    record.archived = archived;
                    let cached = Arc::new(CachedSearch { stamp, archived, record, haystack });
                    let mut index = self.search.lock().unwrap_or_else(|error| error.into_inner());
                    if FileStamp::read(path) == Some(stamp) {
                        index.insert(path.to_path_buf(), cached.clone());
                    } else {
                        index.remove(path);
                    }
                    cached
                };
                if cached.haystack.contains(&needle) {
                    records.push(cached.record.clone());
                }
            }
        }
        self.search.lock().unwrap_or_else(|error| error.into_inner()).retain(|path, _| paths.contains(path));
        records.sort_by(|left, right| right.modified_at.cmp(&left.modified_at));
        records
    }
}

pub(super) fn list(root: &Path) -> Vec<SessionRecord> {
    static CACHE: OnceLock<SessionPreviewCache> = OnceLock::new();
    CACHE.get_or_init(SessionPreviewCache::default).list(root)
}

pub(super) fn list_with_archived(root: &Path, archived_root: &Path) -> Vec<SessionRecord> {
    static CACHE: OnceLock<SessionPreviewCache> = OnceLock::new();
    CACHE
        .get_or_init(SessionPreviewCache::default)
        .list_with_archived(root, archived_root)
}

pub(super) fn search_with_archived(root: &Path, archived_root: &Path, query: &str) -> Vec<SessionRecord> {
    static CACHE: OnceLock<SessionPreviewCache> = OnceLock::new();
    CACHE
        .get_or_init(SessionPreviewCache::default)
        .search_with_archived(root, archived_root, query)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{cell::Cell, fs::File, time::Duration};

    const SESSION: &str = concat!(
        "{\"type\":\"session\",\"id\":\"cached-session\"}\n",
        "{\"type\":\"session_info\",\"name\":\"原始名称\"}\n",
        "{\"type\":\"message\",\"message\":{\"role\":\"user\",\"content\":\"检查工程\"}}\n"
    );

    #[test]
    fn session_preview_reuses_unchanged_file_and_refreshes_appended_content() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("session.jsonl");
        fs::write(&path, SESSION).unwrap();
        let cache = SessionPreviewCache::default();
        let reads = Cell::new(0);
        let parse = |path: &Path| {
            reads.set(reads.get() + 1);
            parse_session_record(path)
        };
        assert_eq!(cache.read_with(&path, parse).unwrap().message_count, 1);
        assert_eq!(cache.read_with(&path, parse).unwrap().message_count, 1);
        assert_eq!(reads.get(), 1);

        let original_stamp = FileStamp::read(&path).unwrap();
        fs::write(
            &path,
            format!("{SESSION}{{\"type\":\"session_info\",\"name\":\"更新的标题\"}}\n"),
        )
        .unwrap();
        // 即使文件系统时间精度不足，长度变化仍必须让旧预览失效。
        File::options()
            .write(true)
            .open(&path)
            .unwrap()
            .set_modified(original_stamp.modified)
            .unwrap();
        assert_eq!(
            cache.read_with(&path, parse).unwrap().name.as_deref(),
            Some("更新的标题")
        );
        assert_eq!(reads.get(), 2);

        fs::write(&path, "{\"type\":\"session\",\"id\":\"empty\"}\n").unwrap();
        assert_eq!(cache.read_with(&path, parse).unwrap().message_count, 0);
        assert_eq!(reads.get(), 3);
    }

    #[test]
    fn session_preview_refreshes_same_size_edits_and_prunes_deleted_files() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("session.jsonl");
        fs::write(&path, SESSION).unwrap();
        let cache = SessionPreviewCache::default();
        assert_eq!(
            cache.list(directory.path())[0].name.as_deref(),
            Some("原始名称")
        );
        let stamp = FileStamp::read(&path).unwrap();
        fs::write(&path, SESSION.replace("原始名称", "新的名称")).unwrap();
        File::options()
            .write(true)
            .open(&path)
            .unwrap()
            .set_modified(stamp.modified + Duration::from_secs(2))
            .unwrap();
        assert_eq!(
            cache.list(directory.path())[0].name.as_deref(),
            Some("新的名称")
        );

        fs::remove_file(&path).unwrap();
        assert!(cache.list(directory.path()).is_empty());
        assert!(cache.entries.lock().unwrap().is_empty());
    }

    #[test]
    fn session_preview_does_not_cache_a_file_changed_during_parsing() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("session.jsonl");
        fs::write(&path, SESSION).unwrap();
        let cache = SessionPreviewCache::default();
        let record = cache
            .read_with(&path, |path| {
                let record = parse_session_record(path);
                fs::write(
                    path,
                    format!("{SESSION}{{\"type\":\"session_info\",\"name\":\"写入后的标题\"}}\n"),
                )
                .unwrap();
                record
            })
            .unwrap();
        assert_eq!(record.name.as_deref(), Some("原始名称"));
        assert!(cache.entries.lock().unwrap().is_empty());
        assert_eq!(
            cache.list(directory.path())[0].name.as_deref(),
            Some("写入后的标题")
        );
    }

    #[test]
    fn session_search_reuses_unchanged_metadata_and_includes_archived_files() {
        let directory = tempfile::tempdir().unwrap();
        let active = directory.path().join("sessions");
        let archived = directory.path().join("archived_sessions");
        fs::create_dir_all(&active).unwrap();
        fs::create_dir_all(&archived).unwrap();
        fs::write(active.join("active.jsonl"), concat!(
            "{\"type\":\"session\",\"id\":\"active\"}\n",
            "{\"type\":\"session_info\",\"name\":\"活动会话\"}\n",
            "{\"type\":\"message\",\"message\":{\"role\":\"user\",\"content\":\"索引词\"}}\n",
        )).unwrap();
        fs::write(archived.join("archived.jsonl"), concat!(
            "{\"type\":\"session\",\"id\":\"archived\"}\n",
            "{\"type\":\"session_info\",\"name\":\"已归档会话\"}\n",
            "{\"type\":\"message\",\"message\":{\"role\":\"user\",\"content\":\"索引词\"}}\n",
        )).unwrap();
        let cache = SessionPreviewCache::default();
        let first = cache.search_with_archived(&active, &archived, "索引词");
        assert_eq!(first.len(), 2);
        assert!(first.iter().any(|record| record.archived));
        assert_eq!(cache.search.lock().unwrap().len(), 2);
        let second = cache.search_with_archived(&active, &archived, "索引词");
        assert_eq!(second.len(), 2);
        fs::remove_file(archived.join("archived.jsonl")).unwrap();
        assert_eq!(cache.search_with_archived(&active, &archived, "索引词").len(), 1);
    }

    #[test]
    fn session_search_covers_early_turns_and_long_messages_then_refreshes() {
        let directory = tempfile::tempdir().unwrap();
        let active = directory.path().join("sessions");
        let archived = directory.path().join("archived_sessions");
        fs::create_dir_all(&active).unwrap();
        let path = active.join("long.jsonl");
        let mut content = String::from("{\"type\":\"session\",\"id\":\"long\"}\n");
        for index in 0..100 {
            let text = if index == 0 { "早期检索词" } else { "普通消息" };
            content.push_str(&serde_json::json!({"type":"message","message":{"role":"user","content":text}}).to_string());
            content.push('\n');
        }
        let text = format!("{}长文末尾检索词", "a".repeat(7000));
        content.push_str(&serde_json::json!({"type":"message","message":{"role":"assistant","content":text}}).to_string());
        fs::write(&path, content).unwrap();
        let cache = SessionPreviewCache::default();
        assert_eq!(cache.search_with_archived(&active, &archived, "早期检索词").len(), 1);
        assert_eq!(cache.search_with_archived(&active, &archived, "长文末尾检索词").len(), 1);
        assert!(cache.search_with_archived(&active, &archived, "早期检索词")[0].messages.len() <= crate::MAX_SESSION_PREVIEW_MESSAGES);
        fs::write(&path, SESSION).unwrap();
        assert!(cache.search_with_archived(&active, &archived, "早期检索词").is_empty());
    }
}

use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
    time::SystemTime,
};

use walkdir::WalkDir;

use crate::{parse_session_record, SessionRecord};

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

#[derive(Default)]
struct SessionPreviewCache {
    entries: Mutex<HashMap<PathBuf, CachedPreview>>,
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

    fn list(&self, root: &Path) -> Vec<SessionRecord> {
        let mut records = Vec::new();
        let mut paths = HashSet::new();
        // 保留原有目录深度和符号链接规则；删除的会话也从缓存中释放。
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
            if let Some(record) = self.read_with(path, parse_session_record) {
                records.push(record);
            }
        }
        self.entries
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .retain(|path, _| paths.contains(path));
        records.sort_by(|a, b| b.modified_at.cmp(&a.modified_at));
        records
    }
}

pub(super) fn list(root: &Path) -> Vec<SessionRecord> {
    static CACHE: OnceLock<SessionPreviewCache> = OnceLock::new();
    CACHE.get_or_init(SessionPreviewCache::default).list(root)
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
}

use std::{
    fs,
    path::{Path, PathBuf},
};

use crate::{agent_cwd, AppError, ProjectContext};

/// 普通文件工具不把工作目录当作访问边界。读取沿用系统文件权限，写入是否
/// 等待审批由统一工具调度决定；这里仅解析路径，不写盘或提升访问模式。
pub(crate) fn resolve_path(
    cwd: &Path,
    requested: &Path,
    allow_missing: bool,
) -> Result<PathBuf, AppError> {
    if requested.as_os_str().is_empty() {
        return Err(AppError::Project("请提供文件路径。".into()));
    }
    let candidate = if requested.is_absolute() {
        requested.to_path_buf()
    } else {
        cwd.join(requested)
    };
    if !allow_missing || candidate.exists() {
        return dunce::canonicalize(&candidate).map_err(|error| {
            AppError::Project(format!("无法访问 {}：{error}", candidate.display()))
        });
    }
    // 新建文件可能带尚未存在的多级父目录。先解析已有祖先，再拼回余下路径；
    // 绝对路径、上级相对路径和目录联接均不再因为位于工作目录外而被拒绝。
    let candidate = std::path::absolute(candidate)
        .map_err(|error| AppError::Project(format!("文件路径无法解析：{error}")))?;
    let existing = candidate
        .ancestors()
        .find(|path| path.exists())
        .ok_or_else(|| AppError::Project("文件路径没有可访问的父目录。".into()))?;
    let resolved = dunce::canonicalize(existing)
        .map_err(|error| AppError::Project(format!("文件父目录无法访问：{error}")))?;
    let suffix = candidate
        .strip_prefix(existing)
        .map_err(|error| AppError::Project(format!("文件路径无法解析：{error}")))?;
    Ok(resolved.join(suffix))
}

pub(crate) fn resolve_file(
    project: &ProjectContext,
    requested: &str,
    allow_missing: bool,
) -> Result<PathBuf, AppError> {
    let requested = requested.trim().trim_matches('"');
    let path = resolve_path(&agent_cwd(project), Path::new(requested), allow_missing)?;
    if let Ok(metadata) = fs::metadata(&path) {
        if !metadata.is_file() {
            return Err(AppError::Project(format!(
                "请选择文件，当前路径是目录：{}",
                path.display()
            )));
        }
    }
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ordinary_file_paths_support_external_files_and_missing_output_directories() {
        let root = tempfile::tempdir().unwrap();
        let cwd = root.path().join("workspace");
        let external = root.path().join("attachments");
        fs::create_dir_all(&cwd).unwrap();
        fs::create_dir_all(&external).unwrap();
        let file = external.join("input.txt");
        fs::write(&file, "original").unwrap();
        let canonical = dunce::canonicalize(&file).unwrap();
        assert_eq!(resolve_path(&cwd, &file, false).unwrap(), canonical);
        assert_eq!(
            resolve_path(&cwd, Path::new("../attachments/input.txt"), false).unwrap(),
            canonical
        );
        let output = external.join("new").join("nested").join("output.txt");
        assert_eq!(
            resolve_path(&cwd, &output, true).unwrap(),
            dunce::canonicalize(&external)
                .unwrap()
                .join("new/nested/output.txt")
        );
        assert!(!output.exists());
        assert!(resolve_path(&cwd, &output, false).is_err());
        assert!(resolve_path(&cwd, Path::new(""), false).is_err());
    }
}

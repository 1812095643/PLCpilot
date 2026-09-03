# -*- coding: utf-8 -*-
from __future__ import print_function

"""将当前 CODESYS 主工程的路径和文本对象导出给 PLC Pilot。

脚本只读取 CODESYS 对象，并把副本写入当前用户的本地桥接目录，不会保存或修改工程。
CODESYS 3.5.22 的 ScriptEngine 使用 IronPython 2.7 兼容语法，因此本文件不使用 Python 3 专有语法。
"""

import codecs
import datetime
import hashlib
import json
import os
import re
import shutil
import tempfile

from scriptengine import projects


SCHEMA_VERSION = 1
BRIDGE_FOLDER_NAME = "PLC Pilot\\codesys-bridge"
MAX_OBJECTS = 2000
MAX_SOURCE_BYTES = 4 * 1024 * 1024

try:
    _TEXT_TYPE = unicode
except NameError:
    _TEXT_TYPE = str


def _as_text(value):
    """在 IronPython 2.7 和本地 Python 语法检查环境中统一返回文本。"""
    if isinstance(value, _TEXT_TYPE):
        return value
    try:
        return _TEXT_TYPE(value)
    except Exception:
        return str(value)


def _bridge_root():
    """返回当前用户的桥接根目录，避免把快照写进 CODESYS 安装目录。"""
    local_app_data = os.environ.get("LOCALAPPDATA")
    if not local_app_data:
        user_profile = os.environ.get("USERPROFILE")
        if user_profile:
            local_app_data = os.path.join(user_profile, "AppData", "Local")
    if not local_app_data:
        local_app_data = tempfile.gettempdir()
    return os.path.abspath(os.path.join(local_app_data, BRIDGE_FOLDER_NAME))


def _snapshot_path():
    return os.path.join(_bridge_root(), "current-project.json")


def _is_within(path, root):
    """限制所有导出路径在桥接目录内，防止对象名称造成路径穿越。"""
    path_value = os.path.normcase(os.path.abspath(path)).rstrip(os.sep)
    root_value = os.path.normcase(os.path.abspath(root)).rstrip(os.sep)
    return path_value == root_value or path_value.startswith(root_value + os.sep)


def _safe_segment(value, fallback):
    value = value if value is not None else ""
    value = _as_text(value).strip()
    value = re.sub(r"[<>:\"/\\|?*\x00-\x1f]", "_", value)
    value = value.strip(" .")
    if not value or value in (".", ".."):
        value = fallback
    return value[:120]


def _project_name(project, project_path):
    """优先使用工程文件名；不同 SP22 组件对 ScriptProject 名称 API 支持不同，逐级兼容。"""
    try:
        name = project.get_name(False)
        if name:
            return _as_text(name)
    except Exception:
        pass
    base_name = os.path.basename(project_path)
    name, _ = os.path.splitext(base_name)
    return _as_text(name or base_name or "CODESYS-Project")


def _project_folder(project_name, project_path):
    normalized = os.path.normcase(os.path.abspath(project_path)).replace("\\", "/")
    digest = hashlib.sha1(normalized.encode("utf-8")).hexdigest()[:12]
    return _safe_segment(project_name, "CODESYS-Project") + "-" + digest


def _object_name(obj, index):
    try:
        name = obj.get_name(False)
        if name:
            return _as_text(name)
    except Exception:
        pass
    return "Object-%04d" % index


def _object_type(obj):
    try:
        return _as_text(obj.type)
    except Exception:
        return "unknown"


def _text_part(obj, marker_name, document_name):
    try:
        if not bool(getattr(obj, marker_name)):
            return ""
        document = getattr(obj, document_name)
        value = document.text
        return value if value is not None else ""
    except Exception:
        return ""


def _source_text(obj, name, object_type):
    declaration = _text_part(obj, "has_textual_declaration", "textual_declaration")
    implementation = _text_part(obj, "has_textual_implementation", "textual_implementation")
    if not declaration and not implementation:
        return None
    # 导出副本带有对象元信息，便于 Agent 在多个同名 POU 间定位；正文仍保持 CODESYS 返回的原始文本。
    header = "(* PLC Pilot Bridge: Object=%s; Type=%s *)\n" % (
        name.replace("*)", "* )"),
        object_type,
    )
    parts = [header]
    if declaration:
        parts.append(declaration.rstrip())
    if implementation:
        if declaration:
            parts.append("")
        parts.append(implementation.rstrip())
    return "\n".join(parts).rstrip() + "\n"


def _clear_export_root(export_root, bridge_root):
    """只清理本次工程自己的导出目录，不触碰桥接根目录中的其他工程。"""
    if not _is_within(export_root, bridge_root) or os.path.normcase(export_root) == os.path.normcase(bridge_root):
        raise RuntimeError("导出目录不在桥接根目录内")
    if not os.path.isdir(export_root):
        os.makedirs(export_root)
        return
    for root, directories, files in os.walk(export_root, topdown=False):
        for file_name in files:
            os.remove(os.path.join(root, file_name))
        for directory_name in directories:
            shutil.rmtree(os.path.join(root, directory_name))


def _write_utf8(path, value):
    parent = os.path.dirname(path)
    if not os.path.isdir(parent):
        os.makedirs(parent)
    with codecs.open(path, "w", "utf-8") as stream:
        stream.write(value)


def _write_json_atomically(path, value):
    """使用临时 JSON 再替换目标，避免 Rust 刷新时读取到半个快照。"""
    parent = os.path.dirname(path)
    if not os.path.isdir(parent):
        os.makedirs(parent)
    temporary = path + ".tmp.%d" % os.getpid()
    _write_utf8(temporary, json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True))
    try:
        if os.path.exists(path):
            try:
                import clr
                from System.IO import File
                File.Replace(temporary, path, None)
            except Exception:
                os.remove(path)
                os.rename(temporary, path)
        else:
            os.rename(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.remove(temporary)


def _write_error_snapshot(message):
    snapshot = {
        "schema_version": SCHEMA_VERSION,
        "status": "error",
        "codesys_version": "3.5.22.0",
        "project_path": None,
        "project_name": None,
        "source_root": None,
        "source_files": [],
        "updated_at": datetime.datetime.utcnow().isoformat() + "Z",
        "error": str(message),
    }
    _write_json_atomically(_snapshot_path(), snapshot)


def _export_project(project):
    project_path = os.path.abspath(_as_text(project.path))
    project_name = _project_name(project, project_path)
    bridge_root = _bridge_root()
    export_root = os.path.join(bridge_root, "projects", _project_folder(project_name, project_path))
    if not _is_within(export_root, bridge_root):
        raise RuntimeError("工程导出目录校验未通过")
    if not os.path.isdir(os.path.dirname(export_root)):
        os.makedirs(os.path.dirname(export_root))
    _clear_export_root(export_root, bridge_root)

    source_files = []
    objects = []
    used_paths = {}

    def visit(tree_object, parent_parts):
        if len(objects) >= MAX_OBJECTS:
            return
        try:
            children = tree_object.get_children(False)
        except Exception:
            return
        child_index = 0
        for child in children:
            child_index += 1
            name = _object_name(child, child_index)
            object_type = _object_type(child)
            segment = _safe_segment(name, "Object-%04d" % child_index)
            parts = parent_parts + [segment]
            text = _source_text(child, name, object_type)
            if text is not None:
                relative = "/".join(parts) + ".st"
                duplicate_count = used_paths.get(relative, 0)
                used_paths[relative] = duplicate_count + 1
                if duplicate_count:
                    relative = "/".join(parts) + "-%d.st" % (duplicate_count + 1)
                destination = os.path.abspath(os.path.join(export_root, *relative.split("/")))
                if not _is_within(destination, export_root):
                    raise RuntimeError("对象导出路径未通过根目录校验")
                if len(text.encode("utf-8")) > MAX_SOURCE_BYTES:
                    raise RuntimeError("对象 %s 的源码超过 4 MiB 限制" % name)
                _write_utf8(destination, text)
                source_files.append(relative)
                objects.append({
                    "name": name,
                    "type": object_type,
                    "source_file": relative,
                    "has_declaration": bool(_text_part(child, "has_textual_declaration", "textual_declaration")),
                    "has_implementation": bool(_text_part(child, "has_textual_implementation", "textual_implementation")),
                })
            visit(child, parts)

    visit(project, [])
    snapshot = {
        "schema_version": SCHEMA_VERSION,
        "status": "connected",
        "codesys_version": "3.5.22.0",
        "project_path": project_path,
        "project_name": project_name,
        "source_root": export_root,
        "source_files": source_files,
        "objects": objects,
        "updated_at": datetime.datetime.utcnow().isoformat() + "Z",
        "error": None,
    }
    _write_json_atomically(_snapshot_path(), snapshot)
    return snapshot


def sync_current_project():
    """同步当前主工程；无工程时也写入明确的 no_project 快照。"""
    try:
        project = projects.primary
        if project is None:
            snapshot = {
                "schema_version": SCHEMA_VERSION,
                "status": "no_project",
                "codesys_version": "3.5.22.0",
                "project_path": None,
                "project_name": None,
                "source_root": None,
                "source_files": [],
                "updated_at": datetime.datetime.utcnow().isoformat() + "Z",
                "error": None,
            }
            _write_json_atomically(_snapshot_path(), snapshot)
            print("PLC Pilot Bridge：当前没有打开的 CODESYS 工程")
            return snapshot
        snapshot = _export_project(project)
        print("PLC Pilot Bridge：已导出 %d 个文本对象" % len(snapshot["objects"]))
        return snapshot
    except Exception as error:
        _write_error_snapshot(error)
        print("PLC Pilot Bridge：同步需要处理：%s" % error)
        return None


sync_current_project()

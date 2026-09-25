//! OOXML 按包条目打补丁，未修改条目直接复制压缩数据，不简化重建整个文档。
use std::{collections::BTreeMap, io::{Cursor, Read, Write}, ops::Range};
use roxmltree::{Document, Node};
use serde_json::{json, Value};
use zip::{ZipArchive, ZipWriter, write::SimpleFileOptions};
use super::{error, AppError, DocumentNode};

pub const WORD: &str = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
pub const DRAWING: &str = "http://schemas.openxmlformats.org/drawingml/2006/main";
pub const SHEET: &str = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
pub const REL: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const MAX_PART_BYTES: u64 = 24 * 1024 * 1024;

pub struct Package<'a> { zip: ZipArchive<Cursor<&'a [u8]>> }
impl<'a> Package<'a> {
    pub fn open(bytes: &'a [u8]) -> Result<Self, AppError> {
        let zip = ZipArchive::new(Cursor::new(bytes)).map_err(|e| error(format!("Office 文件不是可读取的 OOXML 包：{e}")))?;
        if zip.len() > 20_000 { return Err(error("文档包条目过多，已停止读取。")); }
        let mut names = std::collections::HashSet::new();
        for name in zip.file_names() { if !names.insert(name.to_string()) { return Err(error("文档存在重复包条目，不能安全编辑。")); } }
        Ok(Self { zip })
    }
    pub fn names(&self) -> Vec<String> { self.zip.file_names().map(str::to_string).collect() }
    pub fn bytes(&mut self, name: &str) -> Result<Vec<u8>, AppError> {
        let mut file = self.zip.by_name(name).map_err(|_| error(format!("文档缺少 {name}")))?;
        if file.size() > MAX_PART_BYTES { return Err(error(format!("文档条目 {name} 超过安全读取上限。"))); }
        let mut bytes = Vec::new(); file.read_to_end(&mut bytes).map_err(|e| error(e.to_string()))?; Ok(bytes)
    }
    pub fn text(&mut self, name: &str) -> Result<String, AppError> { String::from_utf8(self.bytes(name)?).map_err(|_| error(format!("文档条目 {name} 编码不可读取。"))) }
    pub fn optional(&mut self, name: &str) -> Option<String> { self.text(name).ok() }
    pub fn rewrite(mut self, changes: BTreeMap<String, Vec<u8>>) -> Result<Vec<u8>, AppError> {
        let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
        let existing: std::collections::HashSet<String> = self.zip.file_names().map(str::to_string).collect();
        for index in 0..self.zip.len() {
            let file = self.zip.by_index(index).map_err(|e| error(e.to_string()))?;
            if let Some(bytes) = changes.get(file.name()) {
                writer.start_file(file.name(), SimpleFileOptions::default().compression_method(file.compression())).map_err(|e| error(e.to_string()))?;
                writer.write_all(bytes).map_err(|e| error(e.to_string()))?;
            } else { writer.raw_copy_file(file).map_err(|e| error(e.to_string()))?; }
        }
        for (name, bytes) in changes.iter().filter(|(name, _)| !existing.contains(*name)) {
            writer.start_file(name, SimpleFileOptions::default()).map_err(|e| error(e.to_string()))?;
            writer.write_all(bytes).map_err(|e| error(e.to_string()))?;
        }
        writer.finish().map(|c| c.into_inner()).map_err(|e| error(e.to_string()))
    }
}

pub fn xml(text: &str) -> Result<Document<'_>, AppError> { Document::parse(text).map_err(|e| error(format!("文档 XML 不可读取：{e}"))) }
pub fn has(node: Node<'_, '_>, ns: &str, tag: &str) -> bool { node.has_tag_name((ns, tag)) }
pub fn attr<'a>(node: Node<'a, '_>, key: &str) -> Option<&'a str> { node.attributes().find(|a| a.name() == key).map(|a| a.value()) }
pub fn descendant<'a, 'input>(node: Node<'a, 'input>, ns: &str, tag: &str) -> Option<Node<'a, 'input>> { node.descendants().find(|n| has(*n, ns, tag)) }
pub fn number(node: Node<'_, '_>, key: &str, fallback: f64) -> f64 { attr(node, key).and_then(|v| v.parse().ok()).unwrap_or(fallback) }
pub fn escape(text: &str) -> String { text.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;").replace('\'', "&apos;") }
pub fn text_content(node: Node<'_, '_>, ns: &str) -> String {
    node.descendants().filter(|n| has(*n, ns, "t") || has(*n, ns, "tab") || has(*n, ns, "br")).map(|n| match n.tag_name().name() { "tab" => "\t", "br" => "\n", _ => n.text().unwrap_or("") }).collect()
}
pub fn node(id: String, kind: &str, text: String, properties: Value) -> DocumentNode {
    DocumentNode { id, kind: kind.into(), text, children: vec![], properties: properties.as_object().cloned().unwrap_or_default() }
}

pub fn relationships(package: &mut Package<'_>, part: &str) -> Result<BTreeMap<String, String>, AppError> {
    let (directory, name) = part.rsplit_once('/').unwrap_or(("", part));
    let relpath = format!("{directory}/_rels/{name}.rels").trim_start_matches('/').to_string();
    let Some(text) = package.optional(&relpath) else { return Ok(BTreeMap::new()) };
    let document = xml(&text)?;
    let mut result = BTreeMap::new();
    for relation in document.root_element().children().filter(|n| n.is_element()) {
        if relation.attribute("TargetMode") == Some("External") { continue }
        if let (Some(id), Some(target)) = (relation.attribute("Id"), relation.attribute("Target")) {
            let mut path = if target.starts_with('/') { vec![] } else { directory.split('/').filter(|s| !s.is_empty()).collect::<Vec<_>>() };
            for segment in target.split('/') { match segment { ".." => { path.pop().ok_or_else(|| error("文档关系越过包边界。"))?; }, "." | "" => {}, _ => path.push(segment) } }
            result.insert(id.to_string(), path.join("/"));
        }
    }
    Ok(result)
}

pub fn image_uri(package: &mut Package<'_>, name: &str) -> Option<String> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    let mime = match name.rsplit('.').next()?.to_lowercase().as_str() { "png" => "image/png", "jpg" | "jpeg" => "image/jpeg", "gif" => "image/gif", "webp" => "image/webp", "bmp" => "image/bmp", _ => return None };
    let bytes = package.bytes(name).ok()?;
    if bytes.len() > 8 * 1024 * 1024 { return None }
    Some(format!("data:{mime};base64,{}", STANDARD.encode(bytes)))
}

/// 所有替换共用原 XML 的字节坐标，倒序写入，禁止重叠和二次猜测偏移。
pub fn splice(source: &str, mut replacements: Vec<(Range<usize>, String)>) -> Result<String, AppError> {
    replacements.sort_by_key(|(range, _)| range.start);
    if replacements.windows(2).any(|pair| pair[0].0.end > pair[1].0.start) { return Err(error("同一批操作包含重叠的文档对象，请分开修改。")); }
    let mut output = source.to_string();
    for (range, text) in replacements.into_iter().rev() { if !source.is_char_boundary(range.start) || !source.is_char_boundary(range.end) { return Err(error("文档字符边界不可用。")); } output.replace_range(range, &text); }
    xml(&output)?;
    Ok(output)
}

pub fn replace_runs(source: &str, target: Node<'_, '_>, ns: &str, before: &str, after: &str) -> Result<Vec<(Range<usize>, String)>, AppError> {
    let runs = target.descendants().filter(|n| has(*n, ns, "t")).collect::<Vec<_>>();
    let original: String = runs.iter().map(|n| n.text().unwrap_or("")).collect();
    let matches = original.match_indices(before).collect::<Vec<_>>();
    if before.is_empty() || matches.len() != 1 { return Err(error("待替换文字为空、已变化或在对象中出现多次，请缩小选区。")); }
    let start = matches[0].0; let end = start + before.len();
    let mut offset = 0; let mut inserted = false; let mut result = vec![];
    for run in runs {
        let text = run.text().unwrap_or(""); let next = offset + text.len();
        if next > start && offset < end {
            let local_start = start.saturating_sub(offset).min(text.len()); let local_end = end.saturating_sub(offset).min(text.len());
            let mut replacement = text[..local_start].to_string();
            if !inserted { replacement.push_str(after); inserted = true; }
            replacement.push_str(&text[local_end..]);
            let original_tag = &source[run.range()];
            let open_end = original_tag.find('>').ok_or_else(|| error("文字对象没有起始标签。"))?;
            let close_start = original_tag.rfind("</").ok_or_else(|| error("文字对象没有结束标签。"))?;
            let open = original_tag[..open_end].replace("xml:space=\"default\"", "xml:space=\"preserve\"");
            let space = if open.contains("xml:space=") { "" } else { " xml:space=\"preserve\"" };
            result.push((run.range(), format!("{open}{space}>{}{}", escape(&replacement), &original_tag[close_start..])));
        }
        offset = next;
    }
    Ok(result)
}

pub fn object_properties(part: &str, index: usize, tag: &str) -> Value { json!({"part":part,"index":index,"tag":tag}) }

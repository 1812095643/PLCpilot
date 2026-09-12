use std::{
    io::{Cursor, Read},
    path::Path,
};

use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use calamine::{open_workbook_auto_from_rs, Reader as CalamineReader};
use quick_xml::{events::Event, Reader, XmlVersion};
use serde::{Deserialize, Serialize};
use zip::ZipArchive;

const MAX_ATTACHMENT_FILES: usize = 12;
const MAX_ATTACHMENT_SINGLE_BYTES: usize = 8 * 1024 * 1024;
const MAX_ATTACHMENT_TOTAL_BYTES: usize = 24 * 1024 * 1024;
const MAX_ATTACHMENT_TEXT_BYTES: usize = 2 * 1024 * 1024;

/// 前端附件在 IPC 中的稳定表示。
///
/// 图片遵循 Codex 的 `Image`/`image_url` 语义，`data_base64` 只作为桌面桥接
/// 的传输字段；文本文件在进入模型前会变成带文件名的正文。二进制工作簿则
/// 在这里转换为可读文本，避免把压缩包字节直接伪装成普通文本。
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AttachmentInput {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default, alias = "mimeType")]
    pub mime_type: String,
    #[serde(default)]
    pub size: usize,
    #[serde(default)]
    pub kind: String,
    #[serde(default, alias = "dataBase64")]
    pub data_base64: Option<String>,
    #[serde(default, alias = "imageUrl")]
    pub image_url: Option<String>,
    #[serde(default, alias = "textContent")]
    pub text_content: Option<String>,
    #[serde(default)]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CodexImageInput {
    /// 与 Codex `UserInput::Image` 一致的预编码 data URI。
    pub image_url: String,
}

impl AttachmentInput {
    fn extension(&self) -> String {
        Path::new(&self.name)
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase()
    }

    fn decoded_bytes(&self) -> Result<Vec<u8>, String> {
        let encoded = self
            .data_base64
            .as_deref()
            .or_else(|| self.image_url.as_deref())
            .ok_or_else(|| "附件没有可读取的数据".to_string())?;
        let payload = encoded
            .split_once(',')
            .map(|(_, value)| value)
            .unwrap_or(encoded)
            .trim();
        BASE64_STANDARD
            .decode(payload)
            .map_err(|error| format!("附件编码无法解析：{error}"))
    }

    fn image_data_url(&self) -> Option<String> {
        if let Some(url) = self
            .image_url
            .as_deref()
            .filter(|value| value.starts_with("data:"))
        {
            return Some(url.to_string());
        }
        let encoded = self.data_base64.as_deref()?.trim();
        let mime = if self.mime_type.trim().is_empty() {
            "application/octet-stream"
        } else {
            self.mime_type.trim()
        };
        Some(format!("data:{mime};base64,{encoded}"))
    }
}

/// 读取用户通过系统剪贴板传入的本地文件，返回可继续交给前端附件管线的内容。
/// 这是只读操作；文件路径不会写入会话正文或日志。
pub fn read_local_file(path: &Path) -> Result<AttachmentInput, String> {
    let metadata =
        std::fs::metadata(path).map_err(|error| format!("读取文件属性未完成：{error}"))?;
    if !metadata.is_file() {
        return Err("剪贴板路径不是普通文件".to_string());
    }
    let size =
        usize::try_from(metadata.len()).map_err(|_| "文件大小超出当前系统支持范围".to_string())?;
    if size > MAX_ATTACHMENT_SINGLE_BYTES {
        return Err(format!(
            "文件超过 {} MB 单文件上限",
            MAX_ATTACHMENT_SINGLE_BYTES / 1024 / 1024
        ));
    }
    let bytes = std::fs::read(path).map_err(|error| format!("读取剪贴板文件未完成：{error}"))?;
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("未命名文件")
        .to_string();
    let mime_type = mime_type_for_name(&name);
    let kind = if mime_type.starts_with("image/") {
        "image"
    } else if is_text_name(&name, &mime_type) {
        "text"
    } else {
        "file"
    };
    let mut attachment = AttachmentInput {
        name,
        mime_type,
        size,
        kind: kind.to_string(),
        data_base64: Some(BASE64_STANDARD.encode(bytes)),
        ..AttachmentInput::default()
    };
    let mut items = vec![attachment.clone()];
    prepare_attachments(&mut items);
    attachment = items.remove(0);
    Ok(attachment)
}

fn mime_type_for_name(name: &str) -> String {
    let extension = Path::new(name)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let known = match extension.as_str() {
        "csv" => "text/csv",
        "txt" | "log" | "md" => "text/plain",
        "json" => "application/json",
        "xml" => "application/xml",
        "html" | "htm" => "text/html",
        "st" | "iecst" => "text/plain",
        "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "xlsm" => "application/vnd.ms-excel.sheet.macroEnabled.12",
        "xls" => "application/vnd.ms-excel",
        "xlsb" => "application/vnd.ms-excel.sheet.binary.macroEnabled.12",
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "pptx" => "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "pdf" => "application/pdf",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        _ => "application/octet-stream",
    };
    known.to_string()
}

fn is_text_name(name: &str, mime_type: &str) -> bool {
    if mime_type.starts_with("text/")
        || mime_type == "application/json"
        || mime_type == "application/xml"
    {
        return true;
    }
    matches!(
        Path::new(name)
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase()
            .as_str(),
        "c" | "cc"
            | "cpp"
            | "css"
            | "h"
            | "hpp"
            | "ini"
            | "java"
            | "js"
            | "mjs"
            | "py"
            | "rs"
            | "sql"
            | "toml"
            | "ts"
            | "tsx"
            | "vue"
            | "yaml"
            | "yml"
    )
}

/// 在请求进入 Pi 或 Rust 后备 Agent 前读取附件正文，并限制资源占用。
pub fn prepare_attachments(attachments: &mut Vec<AttachmentInput>) {
    attachments.truncate(MAX_ATTACHMENT_FILES);
    let mut total_bytes = 0usize;
    for attachment in attachments.iter_mut() {
        if attachment.size > MAX_ATTACHMENT_SINGLE_BYTES {
            attachment.error = Some(format!(
                "文件超过 {} MB 单文件上限",
                MAX_ATTACHMENT_SINGLE_BYTES / 1024 / 1024
            ));
            continue;
        }
        total_bytes = total_bytes.saturating_add(attachment.size);
        if total_bytes > MAX_ATTACHMENT_TOTAL_BYTES {
            attachment.error = Some(format!(
                "附件总大小不能超过 {} MB",
                MAX_ATTACHMENT_TOTAL_BYTES / 1024 / 1024
            ));
            continue;
        }

        if attachment.kind == "image" {
            let valid_image = attachment.image_data_url().is_some_and(|_| {
                attachment
                    .decoded_bytes()
                    .is_ok_and(|bytes| bytes.len() <= MAX_ATTACHMENT_SINGLE_BYTES)
            });
            if !valid_image {
                attachment.error = Some("图片没有可读取的数据".to_string());
            }
            continue;
        }
        if attachment.kind == "text" {
            if attachment.text_content.is_none() {
                if let Ok(bytes) = attachment.decoded_bytes() {
                    attachment.text_content = decode_text_bytes(&bytes);
                }
            }
            if attachment.text_content.is_none() {
                attachment.error = Some("文本附件没有可读取的正文".to_string());
                continue;
            }
            if attachment
                .text_content
                .as_ref()
                .is_some_and(|text| text.len() > MAX_ATTACHMENT_TEXT_BYTES)
            {
                attachment.error = Some(format!(
                    "文本内容超过 {} MB 读取上限",
                    MAX_ATTACHMENT_TEXT_BYTES / 1024 / 1024
                ));
            }
            continue;
        }

        let extension = attachment.extension();
        let decoded = match attachment.decoded_bytes() {
            Ok(bytes) if bytes.len() <= MAX_ATTACHMENT_SINGLE_BYTES => bytes,
            Ok(_) => {
                attachment.error = Some(format!(
                    "文件超过 {} MB 单文件上限",
                    MAX_ATTACHMENT_SINGLE_BYTES / 1024 / 1024
                ));
                continue;
            }
            Err(error) => {
                attachment.error = Some(error);
                continue;
            }
        };

        let parsed_text = match extension.as_str() {
            "xlsx" | "xlsm" | "xltx" | "xltm" | "xls" | "xlsb" => {
                extract_spreadsheet_text(&decoded)
            }
            "docx" => extract_docx_text(&decoded),
            "pptx" => extract_pptx_text(&decoded),
            "ods" => extract_ods_text(&decoded),
            "pdf" => extract_pdf_text(&decoded),
            _ => None,
        };
        if let Some(result) = parsed_text {
            match result {
                Ok(text) => {
                    attachment.kind = "text".to_string();
                    attachment.mime_type = "text/plain".to_string();
                    attachment.text_content = Some(text);
                    attachment.data_base64 = None;
                    attachment.error = None;
                }
                Err(error) => {
                    attachment.error = Some(error);
                    attachment.data_base64 = None;
                }
            }
            continue;
        }

        // 未标注 MIME 的纯文本文件仍按 UTF-8/UTF-16 内容读取；二进制文件保持
        // 元数据和清晰原因，不能把随机字节交给模型造成不可追溯的乱码。
        if let Some(text) = decode_text_bytes(&decoded) {
            if text.len() <= MAX_ATTACHMENT_TEXT_BYTES {
                attachment.kind = "text".to_string();
                attachment.mime_type = "text/plain".to_string();
                attachment.text_content = Some(text);
                attachment.data_base64 = None;
                attachment.error = None;
                continue;
            }
        }
        attachment.error = Some(
            "该文件是二进制格式，当前 Agent 没有对应解析器；请导出为 TXT、CSV 或 PDF 文本后再添加。"
                .to_string(),
        );
        attachment.data_base64 = None;
    }
}

/// 生成与 Codex 输入消息相同语义的附件上下文文字。
pub fn attachment_context(attachments: &[AttachmentInput]) -> String {
    let mut sections = Vec::new();
    for attachment in attachments {
        let name = if attachment.name.trim().is_empty() {
            "未命名附件"
        } else {
            attachment.name.trim()
        };
        if let Some(text) = attachment
            .text_content
            .as_deref()
            .filter(|value| !value.is_empty())
        {
            sections.push(format!("附件「{name}」的内容：\n{text}"));
        } else if attachment.kind == "image" && attachment.error.is_none() {
            sections.push(format!(
                "附件「{name}」是一张图片，请直接查看本轮附加的图片。"
            ));
        } else if let Some(error) = attachment.error.as_deref() {
            sections.push(format!("附件「{name}」暂时无法读取：{error}"));
        } else {
            sections.push(format!(
                "附件「{name}」已添加，类型为 {}。",
                attachment.mime_type
            ));
        }
    }
    sections.join("\n\n")
}

pub fn attachment_images(attachments: &[AttachmentInput]) -> Vec<CodexImageInput> {
    attachments
        .iter()
        .filter(|attachment| attachment.kind == "image" && attachment.error.is_none())
        .filter_map(|attachment| {
            let url = attachment.image_data_url()?;
            Some(CodexImageInput { image_url: url })
        })
        .collect()
}

fn decode_text_bytes(bytes: &[u8]) -> Option<String> {
    if bytes.starts_with(&[0xff, 0xfe]) {
        return String::from_utf16(
            &bytes[2..]
                .chunks_exact(2)
                .map(|chunk| u16::from_le_bytes([chunk[0], chunk[1]]))
                .collect::<Vec<_>>(),
        )
        .ok();
    }
    if bytes.starts_with(&[0xfe, 0xff]) {
        return String::from_utf16(
            &bytes[2..]
                .chunks_exact(2)
                .map(|chunk| u16::from_be_bytes([chunk[0], chunk[1]]))
                .collect::<Vec<_>>(),
        )
        .ok();
    }
    let text = std::str::from_utf8(bytes).ok()?.to_string();
    let nul_count = text.bytes().filter(|byte| *byte == 0).count();
    (nul_count * 100 < text.len().max(1)).then_some(text)
}

fn read_zip_entry(bytes: &[u8], name: &str) -> Option<Vec<u8>> {
    let mut archive = ZipArchive::new(Cursor::new(bytes)).ok()?;
    let mut entry = archive.by_name(name).ok()?;
    let mut output = Vec::new();
    entry.read_to_end(&mut output).ok()?;
    Some(output)
}

fn extract_spreadsheet_text(bytes: &[u8]) -> Option<Result<String, String>> {
    let mut workbook = match open_workbook_auto_from_rs(Cursor::new(bytes.to_vec())) {
        Ok(workbook) => workbook,
        Err(error) => return Some(Err(format!("Excel 工作簿无法读取：{error}"))),
    };
    let sheet_names = workbook.sheet_names().to_owned();
    if sheet_names.is_empty() {
        return Some(Err("Excel 工作簿中没有可读取的工作表".to_string()));
    }
    let mut output = Vec::new();
    for sheet_name in sheet_names {
        let range = match workbook.worksheet_range(&sheet_name) {
            Ok(range) => range,
            Err(error) => {
                output.push(format!("工作表 {sheet_name} 读取未完成：{error}"));
                continue;
            }
        };
        let rows = range
            .rows()
            .map(|row| {
                row.iter()
                    .map(ToString::to_string)
                    .collect::<Vec<_>>()
                    .join("\t")
            })
            .collect::<Vec<_>>();
        output.push(format!("工作表 {sheet_name}：\n{}", rows.join("\n")));
    }
    let text = output.join("\n\n");
    if text.trim().is_empty() {
        Some(Err("Excel 工作簿内容为空".to_string()))
    } else {
        Some(Ok(text))
    }
}

fn xml_text(value: &[u8]) -> String {
    let mut reader = Reader::from_reader(value);
    reader.config_mut().trim_text(false);
    let mut buffer = Vec::new();
    let mut output = String::new();
    loop {
        match reader.read_event_into(&mut buffer) {
            Ok(Event::Text(text)) => output.push_str(
                &text
                    .xml_content(XmlVersion::Implicit1_0)
                    .unwrap_or_default(),
            ),
            Ok(Event::CData(text)) => output.push_str(&String::from_utf8_lossy(&text)),
            Ok(Event::Eof) => break,
            Ok(_) => {}
            Err(_) => break,
        }
        buffer.clear();
    }
    output
}

fn extract_docx_text(bytes: &[u8]) -> Option<Result<String, String>> {
    let xml = read_zip_entry(bytes, "word/document.xml")?;
    let text = xml_text(&xml);
    if text.trim().is_empty() {
        Some(Err("Word 文档没有可读取的正文".to_string()))
    } else {
        Some(Ok(text))
    }
}

/// 从 PPTX 的每张幻灯片 XML 中提取文本。PPTX 是 OOXML 压缩包，
/// 只读取 `ppt/slides/slide*.xml`，按文件名中的编号排序，避免把关系文件
/// 或演示文稿元数据误当成正文交给模型。
fn extract_pptx_text(bytes: &[u8]) -> Option<Result<String, String>> {
    let mut archive = match ZipArchive::new(Cursor::new(bytes)) {
        Ok(archive) => archive,
        Err(error) => return Some(Err(format!("PowerPoint 文件无法读取：{error}"))),
    };
    let mut names = (0..archive.len())
        .filter_map(|index| archive.by_index(index).ok().map(|entry| entry.name().to_string()))
        .filter(|name| {
            let file = name.strip_prefix("ppt/slides/slide").unwrap_or_default();
            file.ends_with(".xml") && file[..file.len().saturating_sub(4)].parse::<u32>().is_ok()
        })
        .collect::<Vec<_>>();
    names.sort_by_key(|name| {
        name.strip_prefix("ppt/slides/slide")
            .and_then(|value| value.strip_suffix(".xml"))
            .and_then(|value| value.parse::<u32>().ok())
            .unwrap_or(u32::MAX)
    });
    if names.is_empty() {
        return Some(Err("PowerPoint 中没有可读取的幻灯片".to_string()));
    }
    let mut output = Vec::new();
    for (index, name) in names.iter().enumerate() {
        let xml = match read_zip_entry(bytes, name) {
            Some(xml) => xml,
            None => continue,
        };
        let text = xml_text(&xml);
        if !text.trim().is_empty() {
            output.push(format!("幻灯片 {}：\n{}", index + 1, text.trim()));
        }
    }
    if output.is_empty() {
        Some(Err("PowerPoint 中没有可读取的正文".to_string()))
    } else {
        Some(Ok(output.join("\n\n")))
    }
}

fn extract_ods_text(bytes: &[u8]) -> Option<Result<String, String>> {
    let xml = read_zip_entry(bytes, "content.xml")?;
    let text = xml_text(&xml);
    if text.trim().is_empty() {
        Some(Err("ODS 工作簿没有可读取的内容".to_string()))
    } else {
        Some(Ok(text))
    }
}

fn extract_pdf_text(bytes: &[u8]) -> Option<Result<String, String>> {
    match pdf_extract::extract_text_from_mem(bytes) {
        Ok(text) if !text.trim().is_empty() => Some(Ok(text)),
        Ok(_) => Some(Err(
            "PDF 中没有可读取的文本层；扫描件需要先 OCR。".to_string()
        )),
        Err(error) => Some(Err(format!("PDF 文本读取未完成：{error}"))),
    }
}

#[cfg(test)]
mod tests {
    use std::io::{Cursor, Write};

    use super::{attachment_context, prepare_attachments, AttachmentInput};

    #[test]
    fn utf8_text_attachment_is_preserved() {
        let mut items = vec![AttachmentInput {
            name: "notes.txt".to_string(),
            kind: "file".to_string(),
            mime_type: "text/plain".to_string(),
            data_base64: Some("aGVsbG8=".to_string()),
            size: 5,
            ..AttachmentInput::default()
        }];
        prepare_attachments(&mut items);
        assert_eq!(items[0].kind, "text");
        assert_eq!(items[0].text_content.as_deref(), Some("hello"));
        assert!(attachment_context(&items).contains("hello"));
    }

    #[test]
    fn invalid_binary_is_reported_without_text_corruption() {
        let mut items = vec![AttachmentInput {
            name: "data.bin".to_string(),
            kind: "file".to_string(),
            mime_type: "application/octet-stream".to_string(),
            data_base64: Some("AAECAwQ=".to_string()),
            size: 4,
            ..AttachmentInput::default()
        }];
        prepare_attachments(&mut items);
        assert!(items[0].text_content.is_none());
        assert!(items[0].error.is_some());
    }

    #[test]
    fn xlsx_attachment_is_converted_to_sheet_text() {
        let options = zip::write::SimpleFileOptions::default();
        let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
        let entries = [
            (
                "[Content_Types].xml",
                r#"<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>"#,
            ),
            (
                "_rels/.rels",
                r#"<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>"#,
            ),
            (
                "xl/workbook.xml",
                r#"<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="PLC" sheetId="1" r:id="rId1"/></sheets></workbook>"#,
            ),
            (
                "xl/_rels/workbook.xml.rels",
                r#"<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>"#,
            ),
            (
                "xl/worksheets/sheet1.xml",
                r#"<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>点位</t></is></c><c r="B1" t="inlineStr"><is><t>值</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>温度</t></is></c><c r="B2"><v>42</v></c></row></sheetData></worksheet>"#,
            ),
        ];
        for (name, content) in entries {
            writer
                .start_file(name, options)
                .expect("写入测试工作簿条目");
            writer
                .write_all(content.as_bytes())
                .expect("写入测试工作簿内容");
        }
        let bytes = writer.finish().expect("完成测试工作簿").into_inner();
        let text = super::extract_spreadsheet_text(&bytes)
            .expect("识别工作簿")
            .expect("解析工作簿");
        assert!(text.contains("工作表 PLC"));
        assert!(text.contains("点位\t值"));
        assert!(text.contains("温度\t42"));
    }

    #[test]
    fn pptx_attachment_is_converted_to_slide_text() {
        let options = zip::write::SimpleFileOptions::default();
        let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
        writer.start_file("ppt/slides/slide1.xml", options).expect("写入测试幻灯片");
        writer.write_all(br#"<?xml version="1.0"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:t>Stone API</a:t><a:t>Overview</a:t></p:sld>"#).expect("写入测试幻灯片正文");
        let bytes = writer.finish().expect("完成测试幻灯片").into_inner();
        let text = super::extract_pptx_text(&bytes).expect("识别演示文稿").expect("解析演示文稿");
        assert!(text.contains("幻灯片 1"));
        assert!(text.contains("Stone API"));
    }
}

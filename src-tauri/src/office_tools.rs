use std::{
    fs,
    io::{Cursor, Write},
    path::Path,
};

use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use zip::{write::SimpleFileOptions, ZipWriter};

use super::*;

/// Office 工具使用 Rust 原生 OOXML/PDF 读写，安装包不要求目标电脑额外安装
/// openpyxl、python-docx、python-pptx 或 reportlab。
pub fn tools() -> Vec<McpTool> {
    vec![
        McpTool {
            server_id: BUILTIN_SERVER_ID.into(),
            name: "read_office_document".into(),
            description: Some("读取 Excel、Word、PowerPoint、PDF 文件正文；返回真实解析出的文本。".into()),
            input_schema: json!({
                "type": "object",
                "properties": {"path": {"type": "string", "description": "当前工作目录内的文件路径"}},
                "required": ["path"],
                "additionalProperties": false
            }),
        },
        McpTool {
            server_id: BUILTIN_SERVER_ID.into(),
            name: "write_office_document".into(),
            description: Some("创建或覆盖 Excel、Word、PowerPoint、PDF 文件。默认先生成审批 Diff，批准后才写入。".into()),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "当前工作目录内的目标文件路径"},
                    "operation": {"type": "string", "enum": ["create", "overwrite"], "default": "overwrite"},
                    "content": {"type": "string", "description": "纯文本内容；适用于 Word/PDF，也可作为 Excel 单表 TSV"},
                    "paragraphs": {"type": "array", "items": {"type": "string"}},
                    "sheets": {"type": "array", "items": {"type": "object", "properties": {"name": {"type": "string"}, "rows": {"type": "array", "items": {"type": "array"}}}, "required": ["rows"], "additionalProperties": false}},
                    "slides": {"type": "array", "items": {"type": "object", "properties": {"title": {"type": "string"}, "body": {"type": "string"}}, "additionalProperties": false}}
                },
                "required": ["path"],
                "additionalProperties": false
            }),
        },
    ]
}

pub async fn read(state: &AppState, arguments: Value) -> Result<ToolCallResult, AppError> {
    let requested = arguments
        .get("path")
        .and_then(Value::as_str)
        .ok_or_else(|| AppError::Project("read_office_document 需要 path。".into()))?;
    let project = state.inner.lock().await.project.clone();
    let (path, relative) = resolve_project_file(&project, requested, false)?;
    let file = attachments::read_local_file(&path).map_err(AppError::Project)?;
    if let Some(error) = file.error {
        return Err(AppError::Project(format!("读取 {relative} 未完成：{error}")));
    }
    Ok(json_content(&json!({
        "path": relative,
        "name": file.name,
        "size": file.size,
        "mime_type": file.mime_type,
        "text": file.text_content.unwrap_or_default(),
    }), false))
}

pub async fn propose(state: &AppState, mut arguments: Value) -> Result<PendingChangeSummary, AppError> {
    let project = state.inner.lock().await.project.clone();
    let requested = arguments
        .get("path")
        .and_then(Value::as_str)
        .ok_or_else(|| AppError::Project("write_office_document 需要 path。".into()))?;
    let (path, relative) = resolve_project_file(&project, requested, true)?;
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if !matches!(extension.as_str(), "xlsx" | "docx" | "pptx" | "pdf") {
        return Err(AppError::Project("Office 写入只支持 .xlsx、.docx、.pptx 和 .pdf。".into()));
    }
    let operation = arguments
        .get("operation")
        .and_then(Value::as_str)
        .unwrap_or("overwrite")
        .to_ascii_lowercase();
    if operation == "create" && path.exists() {
        return Err(AppError::Project(format!("目标文件已存在，不能以 create 覆盖：{relative}")));
    }
    if !matches!(operation.as_str(), "create" | "overwrite") {
        return Err(AppError::Project("operation 只能是 create 或 overwrite。".into()));
    }
    // 在审批前完整生成一次内存文件，保证参数在用户确认前就已经通过格式校验。
    let generated = render_document_bytes(&extension, &arguments)?;
    let expected_sha256 = existing_sha256(&path)?;
    arguments["path"] = json!(path.to_string_lossy().into_owned());
    arguments["extension"] = json!(extension);
    arguments["operation"] = json!(operation);
    arguments["expected_sha256"] = expected_sha256.clone().map(Value::String).unwrap_or(Value::Null);
    arguments["generated_size"] = json!(generated.len());
    let session_file = state.inner.lock().await.session.session_file.clone();
    arguments["session_file"] = json!(session_file);
    let id = Uuid::new_v4().to_string();
    let summary = PendingChangeSummary {
        id: id.clone(),
        title: format!("审批后{} Office 文件 {relative}", if operation == "create" { "创建" } else { "写入" }),
        description: format!("{} · {} 字节 · 使用 PLC Pilot 原生 Office 生成器", extension.to_uppercase(), generated.len()),
        diff: format!("目标：{relative}\n格式：{}\n操作：{operation}\n预计大小：{} 字节\n\n批准后会原子写入文件，并在写入前复核文件是否被外部修改。", extension.to_uppercase(), generated.len()),
        server_id: BUILTIN_SERVER_ID.into(),
        tool_name: "write_office_document".into(),
        risk: "覆盖或创建 Office 文件，需要人工审批".into(),
        status: "pending".into(),
    };
    let pending = PendingChange { summary: summary.clone(), arguments };
    state.inner.lock().await.pending.insert(id.clone(), pending.clone());
    state.approvals.lock().await.insert(id, pending);
    Ok(summary)
}

pub fn apply(pending: &PendingChange) -> Result<ToolCallResult, AppError> {
    let path = Path::new(
        pending
            .arguments
            .get("path")
            .and_then(Value::as_str)
            .ok_or_else(|| AppError::Project("Office 审批动作缺少目标路径。".into()))?,
    );
    let expected = pending.arguments.get("expected_sha256").and_then(Value::as_str);
    let actual = existing_sha256(path)?;
    if actual.as_deref() != expected {
        return Err(AppError::Project("Office 文件在审批期间发生变化；为避免覆盖新内容，本次写入已停止。".into()));
    }
    let operation = pending.arguments.get("operation").and_then(Value::as_str).unwrap_or("overwrite");
    if operation == "create" && path.exists() {
        return Err(AppError::Project("目标 Office 文件已存在，创建动作已停止。".into()));
    }
    let extension = pending.arguments.get("extension").and_then(Value::as_str).unwrap_or_default();
    let bytes = render_document_bytes(extension, &pending.arguments)?;
    if let Some(parent) = path.parent() { fs::create_dir_all(parent).map_err(|error| AppError::Project(format!("创建 Office 文件目录未完成：{error}")))?; }
    let temporary = path.with_extension(format!("{}.plc-pilot.tmp", path.extension().and_then(|value| value.to_str()).unwrap_or("office")));
    fs::write(&temporary, &bytes).map_err(|error| AppError::Project(format!("写入 Office 临时文件未完成：{error}")))?;
    if let Err(error) = fs::rename(&temporary, path) {
        let _ = fs::remove_file(&temporary);
        return Err(AppError::Project(format!("替换 Office 文件未完成：{error}")));
    }
    Ok(json_content(&json!({"path": path.to_string_lossy(), "format": extension, "bytes": bytes.len(), "message": "Office 文件已写入"}), false))
}

fn existing_sha256(path: &Path) -> Result<Option<String>, AppError> {
    if !path.exists() { return Ok(None); }
    let bytes = fs::read(path).map_err(|error| AppError::Project(format!("读取 Office 文件未完成：{error}")))?;
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    Ok(Some(format!("{:x}", hasher.finalize())))
}

fn render_document_bytes(extension: &str, arguments: &Value) -> Result<Vec<u8>, AppError> {
    match extension {
        "xlsx" => render_xlsx(arguments),
        "docx" => render_docx(arguments),
        "pptx" => render_pptx(arguments),
        "pdf" => render_pdf(arguments),
        _ => Err(AppError::Project("不支持的 Office 格式。".into())),
    }
}

fn xml_escape(value: &str) -> String {
    value.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;").replace('\'', "&apos;")
}

fn zip_entry(writer: &mut ZipWriter<Cursor<Vec<u8>>>, name: &str, content: &str) -> Result<(), AppError> {
    writer.start_file(name, SimpleFileOptions::default()).map_err(|error| AppError::Project(format!("生成 Office 包未完成：{error}")))?;
    writer.write_all(content.as_bytes()).map_err(|error| AppError::Project(format!("生成 Office 包未完成：{error}")))
}

fn finish_zip(writer: ZipWriter<Cursor<Vec<u8>>>) -> Result<Vec<u8>, AppError> {
    writer.finish().map(|cursor| cursor.into_inner()).map_err(|error| AppError::Project(format!("封装 Office 文件未完成：{error}")))
}

fn text_lines(arguments: &Value) -> Vec<String> {
    if let Some(values) = arguments.get("paragraphs").and_then(Value::as_array) {
        let lines = values.iter().filter_map(Value::as_str).map(str::to_string).collect::<Vec<_>>();
        if !lines.is_empty() { return lines; }
    }
    arguments.get("content").and_then(Value::as_str).unwrap_or_default().lines().map(str::to_string).collect()
}

fn render_xlsx(arguments: &Value) -> Result<Vec<u8>, AppError> {
    let sheets = arguments.get("sheets").and_then(Value::as_array).cloned().unwrap_or_else(|| vec![json!({"name":"Sheet1","rows": text_lines(arguments).into_iter().map(|line| vec![Value::String(line)]).collect::<Vec<_>>()})]);
    let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
    zip_entry(&mut writer, "[Content_Types].xml", &format!("<?xml version=\"1.0\" encoding=\"UTF-8\"?><Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"><Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/><Default Extension=\"xml\" ContentType=\"application/xml\"/><Override PartName=\"/xl/workbook.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml\"/>{}</Types>", (1..=sheets.len()).map(|index| format!("<Override PartName=\"/xl/worksheets/sheet{index}.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml\"/>")).collect::<String>()))?;
    zip_entry(&mut writer, "_rels/.rels", "<?xml version=\"1.0\" encoding=\"UTF-8\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"xl/workbook.xml\"/></Relationships>")?;
    let workbook_sheets = sheets.iter().enumerate().map(|(index, sheet)| format!("<sheet name=\"{}\" sheetId=\"{}\" r:id=\"rId{}\"/>", xml_escape(sheet.get("name").and_then(Value::as_str).unwrap_or(&format!("Sheet{}", index + 1))), index + 1, index + 1)).collect::<String>();
    zip_entry(&mut writer, "xl/workbook.xml", &format!("<?xml version=\"1.0\" encoding=\"UTF-8\"?><workbook xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\"><sheets>{workbook_sheets}</sheets></workbook>"))?;
    let rels = sheets.iter().enumerate().map(|(index, _)| format!("<Relationship Id=\"rId{}\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\" Target=\"worksheets/sheet{}.xml\"/>", index + 1, index + 1)).collect::<String>();
    zip_entry(&mut writer, "xl/_rels/workbook.xml.rels", &format!("<?xml version=\"1.0\" encoding=\"UTF-8\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">{rels}</Relationships>"))?;
    for (index, sheet) in sheets.iter().enumerate() {
        let rows = sheet.get("rows").and_then(Value::as_array).cloned().unwrap_or_default();
        let row_xml = rows.iter().enumerate().map(|(row_index, row)| {
            let cells = row.as_array().cloned().unwrap_or_default().iter().enumerate().filter_map(|(column, value)| {
                if value.is_null() { return None; }
                let reference = format!("{}{}", column_name(column), row_index + 1);
                if let Some(number) = value.as_f64() { Some(format!("<c r=\"{reference}\"><v>{number}</v></c>")) }
                else if let Some(boolean) = value.as_bool() { Some(format!("<c r=\"{reference}\" t=\"b\"><v>{}</v></c>", if boolean { 1 } else { 0 })) }
                else { Some(format!("<c r=\"{reference}\" t=\"inlineStr\"><is><t>{}</t></is></c>", xml_escape(value.as_str().unwrap_or(&value.to_string())))) }
            }).collect::<String>();
            format!("<row r=\"{}\">{cells}</row>", row_index + 1)
        }).collect::<String>();
        zip_entry(&mut writer, &format!("xl/worksheets/sheet{}.xml", index + 1), &format!("<?xml version=\"1.0\" encoding=\"UTF-8\"?><worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\"><sheetData>{row_xml}</sheetData></worksheet>"))?;
    }
    finish_zip(writer)
}

fn column_name(index: usize) -> String {
    let mut value = index + 1;
    let mut output = String::new();
    while value > 0 { let remainder = (value - 1) % 26; output.insert(0, (b'A' + remainder as u8) as char); value = (value - 1) / 26; }
    output
}

fn render_docx(arguments: &Value) -> Result<Vec<u8>, AppError> {
    let body = text_lines(arguments).into_iter().map(|line| format!("<w:p><w:r><w:t xml:space=\"preserve\">{}</w:t></w:r></w:p>", xml_escape(&line))).collect::<String>();
    let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
    zip_entry(&mut writer, "[Content_Types].xml", "<?xml version=\"1.0\" encoding=\"UTF-8\"?><Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"><Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/><Default Extension=\"xml\" ContentType=\"application/xml\"/><Override PartName=\"/word/document.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml\"/></Types>")?;
    zip_entry(&mut writer, "_rels/.rels", "<?xml version=\"1.0\" encoding=\"UTF-8\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"word/document.xml\"/></Relationships>")?;
    zip_entry(&mut writer, "word/document.xml", &format!("<?xml version=\"1.0\" encoding=\"UTF-8\"?><w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"><w:body>{body}<w:sectPr/></w:body></w:document>"))?;
    finish_zip(writer)
}

fn render_pptx(arguments: &Value) -> Result<Vec<u8>, AppError> {
    let slides = arguments.get("slides").and_then(Value::as_array).cloned().unwrap_or_else(|| vec![json!({"title":"PLC Pilot","body": arguments.get("content").and_then(Value::as_str).unwrap_or_default()})]);
    let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
    let overrides = (1..=slides.len()).map(|index| format!("<Override PartName=\"/ppt/slides/slide{index}.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.presentationml.slide+xml\"/>")).collect::<String>();
    zip_entry(&mut writer, "[Content_Types].xml", &format!("<?xml version=\"1.0\" encoding=\"UTF-8\"?><Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"><Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/><Default Extension=\"xml\" ContentType=\"application/xml\"/><Override PartName=\"/ppt/presentation.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml\"/>{overrides}<Override PartName=\"/ppt/slideLayouts/slideLayout1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml\"/><Override PartName=\"/ppt/slideMasters/slideMaster1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml\"/><Override PartName=\"/ppt/theme/theme1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.theme+xml\"/></Types>"))?;
    zip_entry(&mut writer, "_rels/.rels", "<?xml version=\"1.0\" encoding=\"UTF-8\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"ppt/presentation.xml\"/></Relationships>")?;
    let slide_ids = (1..=slides.len()).map(|index| format!("<p:sldId id=\"{}\" r:id=\"rId{}\"/>", 255 + index, index + 1)).collect::<String>();
    zip_entry(&mut writer, "ppt/presentation.xml", &format!("<?xml version=\"1.0\" encoding=\"UTF-8\"?><p:presentation xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\" xmlns:p=\"http://schemas.openxmlformats.org/presentationml/2006/main\"><p:sldMasterIdLst><p:sldMasterId id=\"2147483648\" r:id=\"rId1\"/></p:sldMasterIdLst><p:sldIdLst>{slide_ids}</p:sldIdLst><p:sldSz cx=\"12192000\" cy=\"6858000\" type=\"screen16x9\"/></p:presentation>"))?;
    let slide_rels = (1..=slides.len()).map(|index| format!("<Relationship Id=\"rId{}\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide\" Target=\"slides/slide{index}.xml\"/>", index + 1)).collect::<String>();
    zip_entry(&mut writer, "ppt/_rels/presentation.xml.rels", &format!("<?xml version=\"1.0\" encoding=\"UTF-8\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster\" Target=\"slideMasters/slideMaster1.xml\"/>{slide_rels}</Relationships>"))?;
    zip_entry(&mut writer, "ppt/slideMasters/slideMaster1.xml", "<?xml version=\"1.0\" encoding=\"UTF-8\"?><p:sldMaster xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\" xmlns:p=\"http://schemas.openxmlformats.org/presentationml/2006/main\"><p:cSld name=\"Master\"><p:spTree><p:nvGrpSpPr><p:cNvPr id=\"1\" name=\"\"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld><p:sldLayoutIdLst><p:sldLayoutId id=\"1\" r:id=\"rId1\"/></p:sldLayoutIdLst><p:txStyles/></p:sldMaster>")?;
    zip_entry(&mut writer, "ppt/slideMasters/_rels/slideMaster1.xml.rels", "<?xml version=\"1.0\" encoding=\"UTF-8\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout\" Target=\"../slideLayouts/slideLayout1.xml\"/><Relationship Id=\"rId2\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme\" Target=\"../theme/theme1.xml\"/></Relationships>")?;
    zip_entry(&mut writer, "ppt/slideLayouts/slideLayout1.xml", "<?xml version=\"1.0\" encoding=\"UTF-8\"?><p:sldLayout xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\" xmlns:p=\"http://schemas.openxmlformats.org/presentationml/2006/main\" type=\"title\"><p:cSld name=\"Title\"><p:spTree><p:nvGrpSpPr><p:cNvPr id=\"1\" name=\"\"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>")?;
    zip_entry(&mut writer, "ppt/slideLayouts/_rels/slideLayout1.xml.rels", "<?xml version=\"1.0\" encoding=\"UTF-8\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster\" Target=\"../slideMasters/slideMaster1.xml\"/></Relationships>")?;
    zip_entry(&mut writer, "ppt/theme/theme1.xml", "<?xml version=\"1.0\" encoding=\"UTF-8\"?><a:theme xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" name=\"PLC Pilot\"><a:themeElements><a:clrScheme name=\"Default\"><a:dk1><a:sysClr val=\"windowText\" lastClr=\"000000\"/></a:dk1><a:lt1><a:sysClr val=\"window\" lastClr=\"FFFFFF\"/></a:lt1><a:dk2><a:srgbClr val=\"1F2937\"/></a:dk2><a:lt2><a:srgbClr val=\"F9FAFB\"/></a:lt2><a:accent1><a:srgbClr val=\"F59E0B\"/></a:accent1><a:accent2><a:srgbClr val=\"2563EB\"/></a:accent2><a:accent3><a:srgbClr val=\"10B981\"/></a:accent3><a:accent4><a:srgbClr val=\"EF4444\"/></a:accent4><a:accent5><a:srgbClr val=\"8B5CF6\"/></a:accent5><a:accent6><a:srgbClr val=\"14B8A6\"/></a:accent6><a:hlink><a:srgbClr val=\"0563C1\"/></a:hlink><a:folHlink><a:srgbClr val=\"954F72\"/></a:folHlink></a:clrScheme><a:fontScheme name=\"Default\"><a:majorFont/><a:minorFont/></a:fontScheme><a:fmtScheme name=\"Default\"/></a:themeElements></a:theme>")?;
    for (index, slide) in slides.iter().enumerate() {
        let title = xml_escape(slide.get("title").and_then(Value::as_str).unwrap_or("PLC Pilot"));
        let body = xml_escape(slide.get("body").and_then(Value::as_str).unwrap_or_default());
        let text_shape = |id: usize, name: &str, x: i64, y: i64, cx: i64, cy: i64, text: &str, size: i32| format!("<p:sp><p:nvSpPr><p:cNvPr id=\"{id}\" name=\"{name}\"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x=\"{x}\" y=\"{y}\"/><a:ext cx=\"{cx}\" cy=\"{cy}\"/></a:xfrm><a:prstGeom prst=\"rect\"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang=\"zh-CN\" sz=\"{size}\"/><a:t>{text}</a:t></a:r></a:p></p:txBody></p:sp>");
        let xml = format!("<?xml version=\"1.0\" encoding=\"UTF-8\"?><p:sld xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\" xmlns:p=\"http://schemas.openxmlformats.org/presentationml/2006/main\"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id=\"1\" name=\"\"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>{}{}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>", text_shape(2, "标题", 700000, 500000, 10800000, 1100000, &title, 2800), text_shape(3, "正文", 700000, 1800000, 10800000, 4500000, &body, 1800));
        zip_entry(&mut writer, &format!("ppt/slides/slide{}.xml", index + 1), &xml)?;
        zip_entry(&mut writer, &format!("ppt/slides/_rels/slide{}.xml.rels", index + 1), "<?xml version=\"1.0\" encoding=\"UTF-8\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout\" Target=\"../slideLayouts/slideLayout1.xml\"/></Relationships>")?;
    }
    finish_zip(writer)
}

fn render_pdf(arguments: &Value) -> Result<Vec<u8>, AppError> {
    let text = text_lines(arguments).join("\n");
    let lines = text.lines().map(|line| line.chars().map(|character| if character.is_ascii() { character } else { '?' }).collect::<String>()).collect::<Vec<_>>();
    let mut content = String::from("BT\n/F1 11 Tf\n50 760 Td\n");
    for (index, line) in lines.iter().enumerate() {
        if index > 0 { content.push_str("0 -16 Td\n"); }
        content.push_str(&format!("({}) Tj\n", line.replace('\\', "\\\\").replace('(', "\\(").replace(')', "\\)")));
    }
    content.push_str("ET\n");
    let objects = vec![
        "<< /Type /Catalog /Pages 2 0 R >>".to_string(),
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>".to_string(),
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>".to_string(),
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>".to_string(),
        format!("<< /Length {} >>\nstream\n{}endstream", content.as_bytes().len(), content),
    ];
    let mut output = b"%PDF-1.4\n%\xE2\xE3\xCF\xD3\n".to_vec();
    let mut offsets = vec![0usize];
    for (index, object) in objects.iter().enumerate() {
        offsets.push(output.len());
        output.extend_from_slice(format!("{} 0 obj\n{}\nendobj\n", index + 1, object).as_bytes());
    }
    let xref = output.len();
    output.extend_from_slice(format!("xref\n0 {}\n0000000000 65535 f \n", objects.len() + 1).as_bytes());
    for offset in offsets.iter().skip(1) { output.extend_from_slice(format!("{offset:010} 00000 n \n").as_bytes()); }
    output.extend_from_slice(format!("trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n", objects.len() + 1).as_bytes());
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn office_writers_generate_real_packages() {
        let xlsx = render_xlsx(&json!({"sheets":[{"name":"数据","rows":[["名称",42]]}]})).expect("生成 xlsx");
        let mut archive = zip::ZipArchive::new(Cursor::new(xlsx)).expect("读取 xlsx 包");
        assert!(archive.by_name("xl/workbook.xml").is_ok());
        let docx = render_docx(&json!({"paragraphs":["hello"]})).expect("生成 docx");
        assert!(zip::ZipArchive::new(Cursor::new(docx)).expect("读取 docx 包").by_name("word/document.xml").is_ok());
        let pptx = render_pptx(&json!({"slides":[{"title":"A","body":"B"}]})).expect("生成 pptx");
        assert!(zip::ZipArchive::new(Cursor::new(pptx)).expect("读取 pptx 包").by_name("ppt/slides/slide1.xml").is_ok());
        assert!(render_pdf(&json!({"content":"hello"})).expect("生成 pdf").starts_with(b"%PDF-1.4"));
    }
}

use super::*;
use std::io::{Cursor,Write};
use zip::{write::SimpleFileOptions,ZipWriter};
use serde_json::json;

fn package(parts:&[(&str,&str)])->Vec<u8>{
    let mut writer=ZipWriter::new(Cursor::new(Vec::new()));
    for(name,text)in parts{writer.start_file(*name,SimpleFileOptions::default()).unwrap();writer.write_all(text.as_bytes()).unwrap();}
    writer.finish().unwrap().into_inner()
}
fn docx()->Vec<u8>{package(&[("word/document.xml",r#"<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>设备</w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t>温度为 20 度。</w:t></w:r></w:p></w:body></w:document>"#),("word/styles.xml","<styles>保留原始样式</styles>"),("customXml/item1.xml","<custom>unchanged</custom>")])}

#[test]
fn word_cross_run_unicode_patch_preserves_untouched_parts(){
    let original=docx();let nodes=docx::read(&mut ooxml::Package::open(&original).unwrap()).unwrap();
    let edited=patch::apply(&original,"docx",&nodes,&[DocumentOperation::ReplaceText{target:nodes[0].id.clone(),before:"设备温度".into(),after:"冷却液温度".into()}]).unwrap();
    let mut result=ooxml::Package::open(&edited).unwrap();
    assert_eq!(docx::read(&mut result).unwrap()[0].text,"冷却液温度为 20 度。");
    assert_eq!(result.text("customXml/item1.xml").unwrap(),"<custom>unchanged</custom>");
    assert!(result.text("word/document.xml").unwrap().contains("<w:i/>"));
    let rejected=patch::apply(&original,"docx",&nodes,&[DocumentOperation::ReplaceText{target:nodes[0].id.clone(),before:"不存在的文字".into(),after:"x".into()}]);assert!(rejected.is_err());
}

#[test]
fn spreadsheet_inserts_missing_rows_and_preserves_formulas(){
    let source=r#"<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" s="2"><v>10</v></c><c r="C1"><f>SUM(A1:B1)</f><v>10</v></c></row></sheetData></worksheet>"#;
    let changed=xlsx::set_cell(source,"B1",&json!(12),None).unwrap();
    assert!(changed.find("r=\"B1\"").unwrap()<changed.find("r=\"C1\"").unwrap());
    assert!(changed.contains("<f>SUM(A1:B1)</f>"));
    let changed=xlsx::set_cell(&changed,"A2",&json!(null),Some("SUM(A1:B1)")).unwrap();
    assert!(changed.contains("<row r=\"2\">"));
    assert!(xlsx::coordinate("XFE1").is_err());assert!(xlsx::coordinate("A0").is_err());
}

#[test]
fn presentation_uses_relationship_id_and_shared_coordinate_units(){
    let bytes=package(&[("ppt/presentation.xml",r#"<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/></p:presentation>"#),("ppt/_rels/presentation.xml.rels",r#"<Relationships><Relationship Id="rId1" Target="slides/slide1.xml"/></Relationships>"#),("ppt/slides/slide1.xml",r#"<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:spPr><a:xfrm><a:off x="127000" y="254000"/><a:ext cx="1270000" cy="635000"/></a:xfrm></p:spPr><p:txBody><a:p><a:r><a:t>Original</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>"#)]);
    let nodes=pptx::read(&mut ooxml::Package::open(&bytes).unwrap()).unwrap();assert_eq!(nodes.len(),1);assert_eq!(nodes[0].properties["width"],960.);
    assert_eq!(nodes[0].children[0].properties["bounds"]["x"],10.);
    let output=patch::apply(&bytes,"pptx",&nodes,&[DocumentOperation::ReplaceText{target:nodes[0].children[0].id.clone(),before:"Original".into(),after:"Updated".into()}]).unwrap();
    assert_eq!(pptx::read(&mut ooxml::Package::open(&output).unwrap()).unwrap()[0].children[0].text,"Updated");
}

#[tokio::test]
async fn document_save_undo_and_external_change_are_isolated(){
    let root=tempfile::tempdir().unwrap();let path=root.path().join("测试.docx");let initial=docx();fs::write(&path,&initial).unwrap();
    let scope=uuid::Uuid::new_v4().to_string();let opened=document_open(scope.clone(),Some(path.to_string_lossy().into_owned()),None).await.unwrap();
    let edited=document_apply(opened.id.clone(),scope.clone(),opened.version.clone(),vec![DocumentOperation::ReplaceText{target:opened.nodes[0].id.clone(),before:"20".into(),after:"25".into()}]).await.unwrap();
    assert!(edited.dirty);assert_eq!(fs::read(&path).unwrap(),initial);
    let reverted=document_history(edited.id.clone(),scope.clone(),edited.version,false).await.unwrap();assert!(!reverted.dirty);assert!(reverted.can_redo);
    let redone=document_history(reverted.id.clone(),scope.clone(),reverted.version,true).await.unwrap();
    fs::write(&path,b"external change").unwrap();assert!(document_save(redone.id.clone(),scope.clone(),redone.version.clone()).await.is_err());assert_eq!(fs::read(&path).unwrap(),b"external change");
    fs::write(&path,initial).unwrap();let saved=document_save(redone.id.clone(),scope.clone(),redone.version).await.unwrap();assert!(!saved.dirty);
    assert!(docx::read(&mut ooxml::Package::open(&fs::read(&path).unwrap()).unwrap()).unwrap()[0].text.contains("25"));
    assert!(document_get(saved.id.clone(),"another-thread".into()).is_err());document_close(saved.id,scope).unwrap();
}

#[test]
fn pdf_reads_renders_and_edits_real_text_objects(){
    use pdfium_render::prelude::*;
    let original={
        let pdf=pdf::engine().unwrap();
        let mut doc=pdf.create_new_pdf().unwrap();let font=doc.fonts_mut().helvetica();
        let mut page=doc.pages_mut().create_page_at_start(PdfPagePaperSize::a4()).unwrap();
        page.objects_mut().create_text_object(PdfPoints::new(50.),PdfPoints::new(750.),"Hello Pilot",font,PdfPoints::new(16.)).unwrap();
        doc.save_to_bytes().unwrap()
    };
    let pages=pdf::read(&original).unwrap();assert!(pages[0].text.contains("Hello Pilot"));
    assert!(pdf::render(&original,0,600).unwrap().starts_with("data:image/png;base64,"));
    let output=pdf::apply(&original,&[DocumentOperation::ReplaceText{target:pages[0].children[0].id.clone(),before:"Hello Pilot".into(),after:"Hello PLC".into()}]).unwrap();assert!(pdf::read(&output).unwrap()[0].text.contains("Hello PLC"));
}

#[test]
fn html_is_classified_as_previewable_source(){
    let root=tempfile::tempdir().unwrap();let path=root.path().join("preview.html");
    let source=b"<!doctype html><html><body><h1>PLC Pilot</h1><script>alert('blocked')</script></body></html>";
    let result=snapshot(&path,source,"html-test".into()).unwrap();
    assert_eq!(result.kind,"html");assert_eq!(result.text.as_deref(),Some(std::str::from_utf8(source).unwrap()));
    assert!(!result.can_edit);assert!(result.warnings.iter().any(|item|item.contains("脚本")));
}

//! PDF 对象坐标统一为左上角原点的 pt；渲染和选框消费同一份尺寸。
use std::{io::Cursor,path::PathBuf,sync::{Mutex,OnceLock}};
use pdfium_render::prelude::*;
use serde_json::json;
use base64::{engine::general_purpose::STANDARD,Engine};
use tauri::Manager;
use super::{error,AppError,DocumentNode,DocumentOperation};
static PDFIUM:OnceLock<Pdfium>=OnceLock::new();
static PDF_LOCK:Mutex<()>=Mutex::new(());
fn convert(e:impl std::fmt::Display)->AppError{error(format!("PDF 处理未完成：{e}"))}

pub(super) fn engine()->Result<&'static Pdfium,AppError>{
    if let Some(engine)=PDFIUM.get(){return Ok(engine)}
    let mut paths=vec![PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../runtime-stage/pdf/pdfium.dll")];
    if let Some(app)=super::APP.get(){if let Ok(root)=app.path().resource_dir(){paths.insert(0,root.join("runtime/pdf/pdfium.dll"));}}
    let path=paths.into_iter().find(|p|p.is_file()).ok_or_else(||error("PDF 运行库缺失，请修复安装或重新安装完整包。"))?;
    let binding=Pdfium::bind_to_library(path).map_err(convert)?;
    let _=PDFIUM.set(Pdfium::new(binding));
    PDFIUM.get().ok_or_else(||error("PDF 运行库尚未就绪。"))
}

pub fn read(bytes:&[u8])->Result<Vec<DocumentNode>,AppError>{
    let _guard=PDF_LOCK.lock().map_err(|_|error("PDF 引擎不可用。"))?;
    let pdf=engine()?;
    let document=pdf.load_pdf_from_byte_slice(bytes,None).map_err(convert)?;
    if document.pages().len()>1000{return Err(error("PDF 超过 1000 页，请拆分后编辑。"));}
    let mut pages=vec![];
    for(index,page)in document.pages().iter().enumerate(){
        let height=page.height().value;
        let mut node=super::ooxml::node(format!("page:{index}"),"page",String::new(),json!({"page":index,"width":page.width().value,"height":height}));
        for(object_index,object)in page.objects().iter().enumerate(){
            if object_index>20_000{return Err(error("PDF 页面对象过多，已停止解析。"));}
            let text=object.as_text_object().map(|o|o.text());
            let kind=if text.is_some(){"pdf_text"}else if object.as_image_object().is_some(){"pdf_image"}else{continue};
            let bounds=object.bounds().map_err(convert)?;
            let object_text=text.unwrap_or_default(); node.text.push_str(&object_text);
            node.children.push(super::ooxml::node(format!("page:{index}:object:{object_index}"),kind,object_text,json!({"page":index,"object":object_index,"bounds":{"x":bounds.left().value,"y":height-bounds.top().value,"width":bounds.width().value,"height":bounds.height().value}})));
        }
        pages.push(node);
    }
    Ok(pages)
}

pub fn render(bytes:&[u8],index:u16,width:i32)->Result<String,AppError>{
    let _guard=PDF_LOCK.lock().map_err(|_|error("PDF 引擎不可用。"))?;
    let pdf=engine()?;let document=pdf.load_pdf_from_byte_slice(bytes,None).map_err(convert)?;
    let page=document.pages().get(i32::from(index)).map_err(convert)?;
    let image=page.render_with_config(&PdfRenderConfig::new().set_target_width(width.clamp(300,1800))).map_err(convert)?.as_image().map_err(convert)?;
    let mut output=Cursor::new(Vec::new());image.write_to(&mut output,image::ImageFormat::Png).map_err(convert)?;
    Ok(format!("data:image/png;base64,{}",STANDARD.encode(output.into_inner())))
}

pub fn apply(bytes:&[u8],operations:&[DocumentOperation])->Result<Vec<u8>,AppError>{
    let _guard=PDF_LOCK.lock().map_err(|_|error("PDF 引擎不可用。"))?;
    let pdf=engine()?;let mut document=pdf.load_pdf_from_byte_slice(bytes,None).map_err(convert)?;
    for operation in operations {
        let target=match operation {DocumentOperation::ReplaceText{target,..}|DocumentOperation::ReplaceImage{target,..}=>target,_=>return Err(error("PDF 不支持单元格操作。"))};
        let parts=target.split(':').collect::<Vec<_>>();
        if parts.len()!=4||parts[0]!="page"||parts[2]!="object"{return Err(error("PDF 对象定位不可用，请重新选取。"));}
        let page_index=parts[1].parse::<i32>().map_err(convert)?;let object_index=parts[3].parse::<usize>().map_err(convert)?;
        let mut page=document.pages_mut().get(page_index).map_err(convert)?;
        let mut object=page.objects_mut().get(object_index).map_err(convert)?;
        match operation {
            DocumentOperation::ReplaceText{before,after,..}=>{
                let text=object.as_text_object_mut().ok_or_else(||error("这个对象不是 PDF 文字对象。"))?;
                let original=text.text();
                if before.is_empty()||original.matches(before).count()!=1{return Err(error("PDF 文字已变化或匹配不唯一，请重新选择。"));}
                text.set_text(original.replacen(before,after,1)).map_err(convert)?;
            }
            DocumentOperation::ReplaceImage{path,..}=>{
                let image=image::load_from_memory(&super::read_bytes(std::path::Path::new(path))?).map_err(convert)?;
                object.as_image_object_mut().ok_or_else(||error("这个对象不是 PDF 图片对象。"))?.set_image(&image).map_err(convert)?;
            }
            _=>unreachable!()
        }
        page.regenerate_content().map_err(convert)?;
    }
    document.save_to_bytes().map_err(convert)
}

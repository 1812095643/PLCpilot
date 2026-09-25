use std::collections::BTreeMap;
use serde::{Deserialize,Serialize};
use serde_json::Value;
use super::{ooxml::*, xlsx, error, AppError, DocumentNode};

#[derive(Clone,Serialize,Deserialize)]
#[serde(tag="op",rename_all="snake_case",deny_unknown_fields)]
pub enum DocumentOperation {
    ReplaceText { target:String, before:String, after:String },
    SetCell { sheet:String, address:String, value:Value, #[serde(default)] formula:Option<String> },
    ReplaceImage { target:String, path:String },
}
pub fn find_node<'a>(nodes:&'a [DocumentNode],id:&str)->Option<&'a DocumentNode>{
    for node in nodes { if node.id==id{return Some(node)} if let Some(found)=find_node(&node.children,id){return Some(found)} }
    None
}

pub fn apply(bytes:&[u8],kind:&str,nodes:&[DocumentNode],operations:&[DocumentOperation])->Result<Vec<u8>,AppError>{
    if operations.is_empty()||operations.len()>100{return Err(error("每批文档修改需要 1–100 个操作。"));}
    if kind=="pdf"{return super::pdf::apply(bytes,operations);}
    if !matches!(kind,"docx"|"xlsx"|"pptx"){return Err(error("这个文件类型当前只支持查看。"));}
    let mut package=Package::open(bytes)?;
    let mut changes=BTreeMap::<String,Vec<u8>>::new();
    let mut replacements=BTreeMap::<String,Vec<(std::ops::Range<usize>,String)>>::new();
    for operation in operations {
        match operation {
            DocumentOperation::ReplaceText { target,before,after }=>{
                if before.len()>256*1024||after.len()>256*1024{return Err(error("单次文字修改超过 256 KiB，请拆分操作。"));}
                let target=find_node(nodes,target).ok_or_else(||error("文档对象已变化，请重新读取结构。"))?;
                let part=target.properties.get("part").and_then(Value::as_str).ok_or_else(||error("请选择可编辑的段落或文本框。"))?;
                let index=target.properties.get("index").and_then(Value::as_u64).ok_or_else(||error("对象没有有效索引。"))? as usize;
                let source=package.text(part)?;let document=xml(&source)?;
                let (namespace,tag) = if kind=="docx"{(WORD,"p")}else{(DRAWING,"shape")};
                let object=if tag=="p"{document.descendants().filter(|n|has(*n,WORD,"p")).nth(index)}else{document.descendants().filter(|n|n.tag_name().namespace()==Some("http://schemas.openxmlformats.org/presentationml/2006/main")&&matches!(n.tag_name().name(),"sp"|"pic")).nth(index)}.ok_or_else(||error("对象索引不再匹配文档。"))?;
                replacements.entry(part.into()).or_default().extend(replace_runs(&source,object,namespace,before,after)?);
            }
            DocumentOperation::SetCell { sheet,address,value,formula }=>{
                if kind!="xlsx"{return Err(error("单元格操作只能用于 Excel。"));}
                let target=nodes.iter().find(|n|n.kind=="sheet"&&(&n.id==sheet||&n.text==sheet)).ok_or_else(||error("找不到指定工作表。"))?;
                let source=if let Some(bytes)=changes.get(&target.id){String::from_utf8(bytes.clone()).map_err(|_|error("工作表编码不可用。"))?}else{package.text(&target.id)?};
                changes.insert(target.id.clone(),xlsx::set_cell(&source,address,value,formula.as_deref())?.into_bytes());
            }
            DocumentOperation::ReplaceImage { target,path }=>{
                let target=find_node(nodes,target).ok_or_else(||error("找不到图片对象。"))?;
                let part=target.properties.get("media_part").and_then(Value::as_str).ok_or_else(||error("对象没有可替换图片。"))?;
                let bytes=super::read_bytes(std::path::Path::new(path))?;
                let image=image::load_from_memory(&bytes).map_err(|e|error(format!("图片无法读取：{e}")))?;
                let format=match part.rsplit('.').next().unwrap_or("").to_lowercase().as_str(){"png"=>image::ImageFormat::Png,"jpg"|"jpeg"=>image::ImageFormat::Jpeg,_=>return Err(error("当前仅能原位替换 PNG/JPEG 图片，以保留原文件关系。"))};
                let mut output=std::io::Cursor::new(Vec::new());image.write_to(&mut output,format).map_err(|e|error(e.to_string()))?;
                changes.insert(part.into(),output.into_inner());
            }
        }
    }
    for(part,edits)in replacements{let source=package.text(&part)?;changes.insert(part,splice(&source,edits)?.into_bytes());}
    if kind=="xlsx"{xlsx::invalidate_calculation(&mut package,&mut changes)?;}
    package.rewrite(changes)
}

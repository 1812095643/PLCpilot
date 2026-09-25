use std::collections::BTreeMap;
use serde_json::{json, Value};
use super::{ooxml::*, AppError, DocumentNode};

pub fn read(package: &mut Package<'_>) -> Result<Vec<DocumentNode>, AppError> {
    let workbook = package.text("xl/workbook.xml")?;
    let document = xml(&workbook)?;
    let relations = relationships(package,"xl/workbook.xml")?;
    let strings = if let Some(text) = package.optional("xl/sharedStrings.xml") { xml(&text)?.descendants().filter(|n| has(*n,SHEET,"si")).map(|n| text_content(n,SHEET)).collect::<Vec<_>>() } else { vec![] };
    let mut result = vec![];
    for sheet in document.descendants().filter(|n| has(*n,SHEET,"sheet")) {
        let Some(part) = attr(sheet,"id").and_then(|id| relations.get(id)) else { continue };
        let source = package.text(part)?;
        let doc = xml(&source)?;
        let mut item = node(part.clone(), "sheet", attr(sheet,"name").unwrap_or("Sheet").to_string(), json!({"part":part}));
        let mut count = 0;
        for cell in doc.descendants().filter(|n| has(*n,SHEET,"c")) {
            count += 1;
            if count > 100_000 { return Err(super::error("工作表超过 10 万个非空单元格，请缩小工作簿后编辑。")); }
            let address = attr(cell,"r").unwrap_or("");
            let value = descendant(cell,SHEET,"v").and_then(|n| n.text()).unwrap_or("");
            let text = match attr(cell,"t") { Some("s") => value.parse::<usize>().ok().and_then(|i|strings.get(i)).cloned().unwrap_or_default(), Some("inlineStr") => text_content(cell,SHEET), _ => value.to_string() };
            let formula = descendant(cell,SHEET,"f").map(|f| f.text().unwrap_or("").to_string());
            item.children.push(node(format!("{part}#{address}"),"cell",text,json!({"address":address,"part":part,"formula":formula,"style":attr(cell,"s"),"type":attr(cell,"t")})));
        }
        result.push(item);
    }
    Ok(result)
}

pub fn coordinate(address: &str) -> Result<(u32,u32), AppError> {
    let split = address.find(|c:char| c.is_ascii_digit()).ok_or_else(|| super::error("单元格地址应为 A1 这类格式。"))?;
    let (column,row) = address.split_at(split);
    if column.is_empty() || column.len()>3 || !column.chars().all(|c|c.is_ascii_uppercase()) { return Err(super::error("单元格列名不可用。")); }
    let column = column.bytes().fold(0u32,|value,c|value*26+u32::from(c-b'A'+1));
    let row: u32 = row.parse().map_err(|_|super::error("单元格行号不可用。"))?;
    if column>16384 || row==0 || row>1048576 { return Err(super::error("单元格超过 Excel 行列边界。")); }
    Ok((row,column))
}

pub fn set_cell(source: &str, address: &str, value: &Value, formula: Option<&str>) -> Result<String,AppError> {
    let (row,column)=coordinate(address)?;
    let document=xml(source)?;
    let data=descendant(document.root_element(),SHEET,"sheetData").ok_or_else(||super::error("工作表缺少 sheetData。"))?;
    let existing=data.descendants().find(|n|has(*n,SHEET,"c") && attr(*n,"r")==Some(address));
    if let Some(cell)=existing {
        if descendant(cell,SHEET,"f").is_some_and(|n|matches!(attr(n,"t"),Some("shared"|"array"|"dataTable"))) { return Err(super::error("共享/数组公式必须整体处理，当前不能只覆盖其中一个单元格。")); }
    }
    let namespace_prefix=source[data.range()].trim_start_matches('<').split(|c:char| c=='>' || c=='/' || c.is_whitespace()).next().unwrap_or("sheetData").strip_suffix("sheetData").unwrap_or("");
    let p=namespace_prefix;
    let style=existing.and_then(|n|attr(n,"s")).map(|s|format!(" s=\"{}\"",escape(s))).unwrap_or_default();
    let content=if let Some(formula)=formula {
        format!("<{p}c r=\"{address}\"{style}><{p}f>{}</{p}f></{p}c>",escape(formula.trim_start_matches('=')))
    } else if value.is_number() { format!("<{p}c r=\"{address}\"{style}><{p}v>{value}</{p}v></{p}c>") }
    else if let Some(value)=value.as_bool() { format!("<{p}c r=\"{address}\"{style} t=\"b\"><{p}v>{}</{p}v></{p}c>",u8::from(value)) }
    else { format!("<{p}c r=\"{address}\"{style} t=\"inlineStr\"><{p}is><{p}t xml:space=\"preserve\">{}</{p}t></{p}is></{p}c>",escape(value.as_str().unwrap_or(""))) };
    if let Some(cell)=existing { return splice(source,vec![(cell.range(),content)]); }
    fn insert_into(source:&str,parent:roxmltree::Node<'_,'_>,content:&str,before:Option<usize>)->Result<String,AppError>{
        if let Some(index)=before{return splice(source,vec![(index..index,content.to_string())]);}
        let raw=&source[parent.range()];
        if raw.ends_with("/>") {
            let tag=raw.trim_start_matches('<').split(|c:char|c.is_whitespace()||c=='/').next().unwrap_or("");
            splice(source,vec![(parent.range(),format!("{}>{content}</{tag}>",&raw[..raw.len()-2]))])
        } else {
            let index=parent.range().start+raw.rfind("</").ok_or_else(||super::error("工作表结构不完整。"))?;
            splice(source,vec![(index..index,content.to_string())])
        }
    }
    if let Some(row_node)=data.children().find(|n|has(*n,SHEET,"row") && number(*n,"r",0.)==row as f64) {
        let before=row_node.children().filter(|n|has(*n,SHEET,"c")).find(|n|attr(*n,"r").and_then(|r|coordinate(r).ok()).is_some_and(|(_,c)|c>column)).map(|n|n.range().start);
        insert_into(source,row_node,&content,before)
    } else {
        let before=data.children().filter(|n|has(*n,SHEET,"row")).find(|n|number(*n,"r",0.)>row as f64).map(|n|n.range().start);
        insert_into(source,data,&format!("<{p}row r=\"{row}\">{content}</{p}row>"),before)
    }
}

pub fn invalidate_calculation(package: &mut Package<'_>, changes: &mut BTreeMap<String,Vec<u8>>) -> Result<(),AppError> {
    let source=package.text("xl/workbook.xml")?;
    let document=xml(&source)?;
    let calc=document.descendants().find(|n|has(*n,SHEET,"calcPr"));
    let root=document.root_element();
    let prefix=source[root.range()].trim_start_matches('<').split(|c:char|c.is_whitespace()||c=='>').next().unwrap_or("workbook").strip_suffix("workbook").unwrap_or("");
    let content=format!("<{prefix}calcPr calcMode=\"auto\" fullCalcOnLoad=\"1\" forceFullCalc=\"1\"/>");
    let range=calc.map(|n|n.range()).unwrap_or_else(||{let at=source.rfind("</").unwrap();at..at});
    changes.insert("xl/workbook.xml".into(),splice(&source,vec![(range,content)])?.into_bytes());
    Ok(())
}

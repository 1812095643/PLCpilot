use serde_json::json;
use super::{ooxml::*, AppError, DocumentNode};

pub fn read(package: &mut Package<'_>) -> Result<Vec<DocumentNode>, AppError> {
    let part = "word/document.xml";
    let source = package.text(part)?;
    let document = xml(&source)?;
    let body = descendant(document.root_element(), WORD, "body").ok_or_else(|| super::error("Word 文件没有正文结构。"))?;
    let relations = relationships(package, part)?;
    let paragraphs: Vec<_> = body.descendants().filter(|n| has(*n, WORD, "p")).collect();
    if paragraphs.len() > 20_000 { return Err(super::error("Word 段落数量超过当前编辑上限。")); }
    fn build(node_xml: roxmltree::Node<'_, '_>, paragraphs: &[roxmltree::Node<'_, '_>], relations: &std::collections::BTreeMap<String, String>, package: &mut Package<'_>) -> Option<DocumentNode> {
        let tag = node_xml.tag_name().name();
        if tag == "p" {
            let index = paragraphs.iter().position(|p| *p == node_xml)?;
            let mut result = node(format!("word/document.xml#p{index}"), "paragraph", text_content(node_xml, WORD), object_properties("word/document.xml", index, "p"));
            let props = node_xml.children().find(|n| has(*n, WORD, "pPr"));
            if let Some(props) = props {
                if let Some(align) = descendant(props, WORD, "jc").and_then(|n| attr(n, "val")) { result.properties.insert("align".into(), json!(align)); }
                if let Some(style) = descendant(props, WORD, "pStyle").and_then(|n| attr(n, "val")) { result.properties.insert("style".into(), json!(style)); }
                if descendant(props, WORD, "numPr").is_some() { result.properties.insert("list".into(), json!(true)); }
            }
            for (run_index, run) in node_xml.children().filter(|n| has(*n, WORD, "r") || has(*n, WORD, "hyperlink")).enumerate() {
                let mut item = node(format!("{}:r{run_index}", result.id), "run", text_content(run, WORD), json!({}));
                for (tag, key) in [("b", "bold"), ("i", "italic"), ("u", "underline")] {
                    if let Some(n) = descendant(run, WORD, tag) { item.properties.insert(key.into(), json!(!matches!(attr(n, "val"), Some("0" | "false" | "none")))); }
                }
                if let Some(n) = descendant(run, WORD, "sz") { item.properties.insert("font_size".into(), json!(number(n, "val", 22.0) / 2.0)); }
                if let Some(color) = descendant(run, WORD, "color").and_then(|n| attr(n, "val")).filter(|s| s.len() == 6 && s.chars().all(|c| c.is_ascii_hexdigit())) { item.properties.insert("color".into(), json!(format!("#{color}"))); }
                if !item.text.is_empty() { result.children.push(item); }
                for blip in run.descendants().filter(|n| has(*n, DRAWING, "blip")) {
                    if let Some(name) = attr(blip, "embed").and_then(|id| relations.get(id)) {
                        if let Some(uri) = image_uri(package, name) { result.children.push(node(format!("{}:image{}",result.id,result.children.len()),"image",String::new(),json!({"src":uri,"media_part":name}))); }
                    }
                }
            }
            Some(result)
        } else if matches!(tag, "tbl" | "tr" | "tc") {
            let mut result = node(format!("word/{}:{}", tag, node_xml.range().start), match tag { "tbl" => "table", "tr" => "row", _ => "cell" }, String::new(), json!({}));
            result.children = node_xml.children().filter(|n| n.is_element()).filter_map(|n| build(n, paragraphs, relations, package)).collect();
            Some(result)
        } else { None }
    }
    let mut result: Vec<DocumentNode> = body.children().filter(|n| n.is_element()).filter_map(|n| build(n,&paragraphs,&relations,package)).collect();
    if let Some(section) = descendant(body, WORD, "sectPr") {
        if let Some(size) = descendant(section, WORD, "pgSz") {
            if let Some(first) = result.first_mut() { first.properties.insert("page_width_pt".into(), json!(number(size,"w",11906.0)/20.0)); }
        }
    }
    Ok(result)
}

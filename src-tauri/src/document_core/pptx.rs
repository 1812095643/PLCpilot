use serde_json::json;
use super::{ooxml::*, AppError, DocumentNode};
const PPT:&str="http://schemas.openxmlformats.org/presentationml/2006/main";

pub fn read(package:&mut Package<'_>)->Result<Vec<DocumentNode>,AppError>{
    let source=package.text("ppt/presentation.xml")?;
    let document=xml(&source)?;
    let relations=relationships(package,"ppt/presentation.xml")?;
    let size=descendant(document.root_element(),PPT,"sldSz");
    let width=size.map(|n|number(n,"cx",12192000.)/12700.).unwrap_or(960.);
    let height=size.map(|n|number(n,"cy",6858000.)/12700.).unwrap_or(540.);
    let mut result=vec![];
    for slide in document.descendants().filter(|n|has(*n,PPT,"sldId")) {
        let Some(part)=slide.attribute((REL,"id")).and_then(|id|relations.get(id)) else {continue};
        let source=package.text(part)?;let doc=xml(&source)?;let rels=relationships(package,part)?;
        let mut page=node(part.clone(),"slide",format!("第 {} 页",result.len()+1),json!({"width":width,"height":height,"part":part}));
        let background=doc.descendants().find(|n|has(*n,PPT,"bg")).and_then(|bg|descendant(bg,DRAWING,"srgbClr")).and_then(|n|attr(n,"val"));
        if let Some(color)=background{page.properties.insert("background".into(),json!(format!("#{color}")));}
        for (index,shape) in doc.descendants().filter(|n|has(*n,PPT,"sp")||has(*n,PPT,"pic")).enumerate(){
            let xfrm=descendant(shape,DRAWING,"xfrm");
            let off=xfrm.and_then(|n|descendant(n,DRAWING,"off"));let ext=xfrm.and_then(|n|descendant(n,DRAWING,"ext"));
            let mut item=node(format!("{part}#shape{index}"),if has(shape,PPT,"pic"){"image"}else{"shape"},text_content(shape,DRAWING),object_properties(part,index,"shape"));
            let mut x=off.map(|n|number(n,"x",0.)).unwrap_or(0.);let mut y=off.map(|n|number(n,"y",0.)).unwrap_or(0.);
            let mut w=ext.map(|n|number(n,"cx",3800000.)).unwrap_or(3800000.);let mut h=ext.map(|n|number(n,"cy",700000.)).unwrap_or(700000.);
            // 组合形状使用共同父坐标系的 chOff/chExt 变换，不能把子坐标当幻灯片坐标。
            for group in shape.ancestors().skip(1).filter(|n|has(*n,PPT,"grpSp")){
                if let Some(t)=group.children().find(|n|has(*n,PPT,"grpSpPr")).and_then(|n|descendant(n,DRAWING,"xfrm")){
                    if let (Some(go),Some(ge),Some(co),Some(ce))=(descendant(t,DRAWING,"off"),descendant(t,DRAWING,"ext"),descendant(t,DRAWING,"chOff"),descendant(t,DRAWING,"chExt")){
                        let sx=number(ge,"cx",1.)/number(ce,"cx",1.).max(1.);let sy=number(ge,"cy",1.)/number(ce,"cy",1.).max(1.);
                        x=number(go,"x",0.)+(x-number(co,"x",0.))*sx;y=number(go,"y",0.)+(y-number(co,"y",0.))*sy;w*=sx;h*=sy;
                    }
                }
            }
            item.properties.insert("bounds".into(),json!({"x":x/12700.,"y":y/12700.,"width":w/12700.,"height":h/12700.}));
            item.properties.insert("rotation".into(),json!(xfrm.map(|n|number(n,"rot",0.)/60000.).unwrap_or(0.)));
            if let Some(props)=descendant(shape,DRAWING,"rPr"){item.properties.insert("font_size".into(),json!(number(props,"sz",1800.)/100.));}
            if let Some(name)=descendant(shape,PPT,"cNvPr").and_then(|n|attr(n,"name")){item.properties.insert("name".into(),json!(name));}
            if item.kind=="image"{
                if let Some(media)=descendant(shape,DRAWING,"blip").and_then(|n|attr(n,"embed")).and_then(|id|rels.get(id)){
                    item.properties.insert("media_part".into(),json!(media));
                    if let Some(uri)=image_uri(package,media){item.properties.insert("src".into(),json!(uri));}
                }
            }
            page.children.push(item);
        }
        result.push(page);
    }
    Ok(result)
}

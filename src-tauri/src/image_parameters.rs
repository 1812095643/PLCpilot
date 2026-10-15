use super::*;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SizeConstraints {
    pub multiple: u64,
    pub max_edge: u64,
    pub min_pixels: u64,
    pub max_pixels: u64,
    pub max_ratio: u64,
    pub experimental_above_pixels: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ImageCapabilities {
    pub source: String,
    pub sizes: Vec<String>,
    pub qualities: Vec<String>,
    #[serde(default)]
    pub custom_size: Option<SizeConstraints>,
}

fn catalog() -> &'static Value {
    static CATALOG: std::sync::OnceLock<Value> = std::sync::OnceLock::new();
    CATALOG.get_or_init(|| serde_json::from_str(include_str!("../../shared/image-model-capabilities.json")).expect("内置官方生图参数必须是有效 JSON"))
}

pub fn official(model: &str) -> Option<ImageCapabilities> {
    let name = model.rsplit('/').next().unwrap_or(model).to_ascii_lowercase();
    let newer = name.starts_with("gpt-image-2.5-sunburst") || name.starts_with("gpt-image-2.5-flare");
    let flexible = newer || name == "gpt-image-2" || name.starts_with("gpt-image-2-");
    if !flexible && !name.starts_with("gpt-image-1") && name != "chatgpt-image-latest" { return None; }
    let data = catalog();
    Some(ImageCapabilities {
        source: data["source"].as_str().unwrap_or_default().into(),
        sizes: serde_json::from_value(if flexible { data["flexible"]["sizes"].clone() } else { data["standard"]["sizes"].clone() }).expect("官方尺寸"),
        qualities: serde_json::from_value(if newer { data["quality_2_5"].clone() } else { data["standard"]["qualities"].clone() }).expect("官方质量"),
        custom_size: if flexible { serde_json::from_value(data["flexible"]["constraints"].clone()).ok() } else { None },
    })
}

fn string_options(value: Option<&Value>) -> Vec<String> {
    value.and_then(Value::as_array).into_iter().flatten().filter_map(Value::as_str)
        .map(str::trim).filter(|value| !value.is_empty() && value.len() <= 40 && value.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-'))
        .take(32).map(str::to_string).collect()
}

/// /models 的标准字段不含图片参数；仅采纳服务商实际返回的枚举，已知 GPT 模型以官方能力为准。
pub fn discovered(model: &str, value: &Value) -> Option<ImageCapabilities> {
    if let Some(known) = official(model) { return Some(known); }
    let metadata = value.get("image_parameters").or_else(|| value.get("image_generation"))
        .or_else(|| value.pointer("/capabilities/image_generation")).unwrap_or(value);
    let sizes = string_options(metadata.get("supported_sizes").or_else(|| metadata.get("sizes")).or_else(|| metadata.pointer("/size/enum")));
    let qualities = string_options(metadata.get("supported_qualities").or_else(|| metadata.get("qualities")).or_else(|| metadata.pointer("/quality/enum")));
    if sizes.is_empty() && qualities.is_empty() { return None; }
    Some(ImageCapabilities { source: "provider".into(), sizes: if sizes.is_empty() { vec!["auto".into()] } else { sizes }, qualities: if qualities.is_empty() { vec!["auto".into()] } else { qualities }, custom_size: None })
}

pub fn for_model(model: &str, supplied: Option<&ImageCapabilities>) -> ImageCapabilities {
    official(model).or_else(|| supplied.filter(|caps| caps.source == "provider").cloned())
        .unwrap_or_else(|| ImageCapabilities { source: String::new(), sizes: vec!["auto".into()], qualities: vec!["auto".into()], custom_size: None })
}

pub fn validate(caps: &ImageCapabilities, size: &str, quality: &str) -> Result<(), AppError> {
    if !caps.qualities.iter().any(|item| item == quality) {
        return Err(AppError::Configuration(format!("当前生图模型不支持质量 {quality}，请重新选择。")));
    }
    if caps.sizes.iter().any(|item| item == size) { return Ok(()); }
    if let Some(rule) = &caps.custom_size {
        if let Some((width, height)) = size.split_once('x').and_then(|(w, h)| Some((w.parse::<u64>().ok()?, h.parse::<u64>().ok()?))) {
            let pixels = width.saturating_mul(height);
            if rule.multiple > 0 && width > 0 && height > 0 && width <= rule.max_edge && height <= rule.max_edge
                && width % rule.multiple == 0 && height % rule.multiple == 0
                && width.max(height) <= width.min(height).saturating_mul(rule.max_ratio)
                && pixels >= rule.min_pixels && pixels <= rule.max_pixels { return Ok(()); }
        }
        return Err(AppError::Configuration("尺寸需为宽x高，宽高为 16 的倍数、每边不超过 3840，长宽比不超过 3:1，总像素为 655360–8294400。".into()));
    }
    Err(AppError::Configuration("当前模型不支持该图片尺寸，请从已提供的尺寸中选择。".into()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gpt_image_parameters_follow_model_families() {
        let earlier = official("gpt-image-2").unwrap();
        assert!(validate(&earlier, "3840x2160", "high").is_ok());
        assert!(validate(&earlier, "1536x864", "max").is_err());
        assert!(validate(&official("gpt-image-2.5-flare-2026-09-08").unwrap(), "1536x864", "max").is_ok());
        assert!(validate(&official("gpt-image-1.5").unwrap(), "3840x2160", "high").is_err());
    }

    #[test]
    fn custom_dimensions_validate_every_official_constraint() {
        let caps = official("gpt-image-2").unwrap();
        for size in ["0x1024", "1000x1024", "4000x2048", "3840x3840", "512x512", "3840x640", "18446744073709551615x16"] {
            assert!(validate(&caps, size, "auto").is_err(), "{size}");
        }
        assert!(validate(&caps, "2048x1152", "low").is_ok());
    }

    #[test]
    fn provider_metadata_is_explicit_and_does_not_extend_gpt_capabilities() {
        assert!(discovered("custom", &json!({"id":"custom","owned_by":"provider"})).is_none());
        let value = json!({"image_parameters":{"sizes":["768x1024"],"qualities":["standard"]}});
        assert!(validate(&discovered("custom", &value).unwrap(), "768x1024", "standard").is_ok());
        assert!(!discovered("gpt-image-2", &json!({"supported_qualities":["max"]})).unwrap().qualities.contains(&"max".to_string()));
    }
}

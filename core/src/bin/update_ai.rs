fn main() {
    let mut config = yiboflow_core::config::AppConfig::load_or_default();
    config.ai_engine.endpoints.clear();
    config.ai_engine.endpoints.push(yiboflow_core::config::AiEndpoint {
        provider: yiboflow_core::config::AiProvider::OllamaLAN,
        base_url: "http://192.168.1.88:11434/v1".to_string(),
        api_key: "".to_string(),
        model: "qwen3:0.6b".to_string(),
        is_enabled: true,
        priority: 1,
    });
    config.ai_engine.endpoints.push(yiboflow_core::config::AiEndpoint {
        provider: yiboflow_core::config::AiProvider::OllamaLAN,
        base_url: "https://lisibo.top:98/v1".to_string(),
        api_key: "".to_string(),
        model: "qwen3:0.6b".to_string(),
        is_enabled: true,
        priority: 2,
    });
    config.save();
    println!("Config successfully updated!");
}

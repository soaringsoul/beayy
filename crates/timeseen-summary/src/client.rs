use serde_json::{json, Map, Value};
use std::io::{BufRead, BufReader, Read};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const CODEX_VERSION: &str = "0.167.0";
const RESPONSE_LIMIT: u64 = 8 * 1024 * 1024;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct ClientOptions {
    pub codex: bool,
    pub responses: bool,
}

impl ClientOptions {
    pub fn new(client: &str, protocol: &str) -> Result<Self, String> {
        if !matches!(client, "timeseen" | "beayy" | "codex") {
            return Err("客户端兼容选项需为 timeseen 或 codex".into());
        }
        if !matches!(protocol, "chat" | "responses") {
            return Err("模型协议需为 chat 或 responses".into());
        }
        Ok(Self { codex: client == "codex", responses: protocol == "responses" })
    }

    pub fn from_settings(settings: &Map<String, Value>) -> Result<Self, String> {
        for name in ["model_client", "model_protocol"] {
            if settings.get(name).map(|value| !value.is_string()).unwrap_or(false) {
                return Err(format!("{name} 必须是字符串"));
            }
        }
        let client = settings.get("model_client").and_then(Value::as_str).unwrap_or("timeseen");
        let protocol = settings.get("model_protocol").and_then(Value::as_str).unwrap_or("chat");
        Self::new(client, protocol)
    }

    pub fn headers(self, session: &str) -> Vec<(&'static str, String)> {
        let timeseen = format!("TimeSeen/{}", env!("CARGO_PKG_VERSION"));
        if !self.codex {
            return vec![("User-Agent", timeseen)];
        }
        vec![
            ("User-Agent", format!("codex_cli_rs/{CODEX_VERSION} ({timeseen}; {}; {})", std::env::consts::OS, std::env::consts::ARCH)),
            ("originator", "codex_cli_rs".into()),
            ("version", CODEX_VERSION.into()),
            ("session-id", session.into()),
            ("thread-id", session.into()),
            ("x-codex-window-id", format!("{session}:0")),
        ]
    }

    pub fn request(self, base: &str, model: &str, system: &str, user: &str) -> (String, Value) {
        let base = base.trim_end_matches('/');
        if self.responses {
            (format!("{base}/responses"), json!({
                "model": model,
                "instructions": system,
                "input": [{"role": "user", "content": [{"type": "input_text", "text": user}]}],
                "stream": true,
                "store": false,
            }))
        } else {
            (format!("{base}/chat/completions"), json!({
                "model": model, "temperature": 0.3, "stream": self.codex,
                "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
            }))
        }
    }
}

pub fn session_id() -> String {
    static SEQUENCE: AtomicU64 = AtomicU64::new(0);
    let stamp = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos();
    let stamp = stamp ^ ((std::process::id() as u128) << 64) ^ SEQUENCE.fetch_add(1, Ordering::Relaxed) as u128;
    format!("{:08x}-{:04x}-4{:03x}-8{:03x}-{:012x}", (stamp >> 96) as u32, (stamp >> 80) as u16,
        (stamp >> 64) as u16 & 0x0fff, (stamp >> 48) as u16 & 0x0fff, stamp & 0xffffffffffff)
}

pub fn agent(timeout: Duration) -> ureq::Agent {
    ureq::Agent::config_builder()
        .proxy(None)
        .tls_config(ureq::tls::TlsConfig::builder().provider(ureq::tls::TlsProvider::NativeTls).root_certs(ureq::tls::RootCerts::PlatformVerifier).build())
        .timeout_connect(Some(Duration::from_secs(10)))
        .timeout_global(Some(timeout))
        .max_redirects(0)
        .http_status_as_error(false)
        .build()
        .into()
}

fn error_message(value: &Value) -> Option<&str> {
    value["error"]["message"].as_str().or_else(|| value["error"].as_str())
        .or_else(|| value["message"].as_str()).or_else(|| value["detail"].as_str())
        .filter(|message| !message.trim().is_empty())
}

fn output_text(value: &Value, responses: bool) -> Result<String, String> {
    if !value["error"].is_null() {
        return Err(error_message(value).unwrap_or("模型返回了错误").to_string());
    }
    if responses {
        if let Some(status) = value["status"].as_str() {
            if status != "completed" {
                return Err(format!("Responses 未完成：{status}"));
            }
        }
        let text = value["output"].as_array().into_iter().flatten()
            .filter(|item| item["type"] == "message")
            .flat_map(|item| item["content"].as_array().into_iter().flatten())
            .filter(|part| part["type"] == "output_text")
            .filter_map(|part| part["text"].as_str()).collect::<String>();
        if !text.trim().is_empty() { return Ok(text); }
        return Err("Responses 未返回文本内容".into());
    }
    value["choices"][0]["message"]["content"].as_str().filter(|text| !text.trim().is_empty())
        .map(String::from).ok_or_else(|| "网关没有返回聊天内容".into())
}

fn usage_of(value: &Value) -> Value {
    let mut usage = value["usage"].as_object().cloned().unwrap_or_default();
    if let Some(tokens) = usage.get("input_tokens").cloned() { usage.insert("prompt_tokens".into(), tokens); }
    if let Some(tokens) = usage.get("output_tokens").cloned() { usage.insert("completion_tokens".into(), tokens); }
    Value::Object(usage)
}

pub fn json_object(text: &str) -> Result<Map<String, Value>, String> {
    let (Some(start), Some(end)) = (text.find('{'), text.rfind('}')) else {
        return Err("模型有响应，但未按要求返回 JSON 对象".into());
    };
    if start > end { return Err("模型返回的 JSON 无效".into()); }
    match serde_json::from_str::<Value>(&text[start..=end]) {
        Ok(Value::Object(value)) => Ok(value),
        _ => Err("模型返回的 JSON 无效".into()),
    }
}

fn decode_event(data: &str, responses: bool, text: &mut String, final_reply: &mut Option<Value>, done: &mut bool, usage: &mut Value) -> Result<(), String> {
    if data == "[DONE]" {
        if !responses { *done = true; }
        return Ok(());
    }
    let event: Value = serde_json::from_str(data).map_err(|_| "模型事件流包含无效 JSON".to_string())?;
    if !event["error"].is_null() || matches!(event["type"].as_str(), Some("error" | "response.failed" | "response.incomplete")) {
        return Err(error_message(&event).or_else(|| error_message(&event["response"])).unwrap_or("模型事件流失败或未完成").into());
    }
    if responses {
        if event["type"] == "response.completed" {
            *final_reply = Some(event["response"].clone());
            *done = true;
        }
    } else {
        if let Some(delta) = event["choices"][0]["delta"]["content"].as_str() { text.push_str(delta); }
        if event["usage"].is_object() { *usage = usage_of(&event); }
    }
    Ok(())
}

fn decode_stream(reader: impl Read, responses: bool) -> Result<(String, Value), String> {
    let mut reader = BufReader::new(reader.take(RESPONSE_LIMIT + 1));
    let mut line = String::new();
    let mut data = String::new();
    let mut text = String::new();
    let mut final_reply = None;
    let mut done = false;
    let mut usage = json!({});
    let mut received = 0;
    loop {
        line.clear();
        let count = reader.read_line(&mut line).map_err(|_| "模型事件流读取失败".to_string())?;
        if count == 0 { break; }
        received += count as u64;
        if received > RESPONSE_LIMIT { return Err("模型响应超过 8 MB".into()); }
        let line = line.trim_end_matches(['\r', '\n']);
        if line.is_empty() {
            if !data.is_empty() {
                decode_event(data.trim_end_matches('\n'), responses, &mut text, &mut final_reply, &mut done, &mut usage)?;
                data.clear();
                if done { break; }
            }
        } else if let Some(value) = line.strip_prefix("data:") {
            data.push_str(value.strip_prefix(' ').unwrap_or(value));
            data.push('\n');
        }
    }
    if !data.is_empty() {
        decode_event(data.trim_end_matches('\n'), responses, &mut text, &mut final_reply, &mut done, &mut usage)?;
    }
    if !done { return Err("模型事件流提前结束，未收到完成事件".into()); }
    if responses {
        let reply = final_reply.ok_or("Responses 缺少 response.completed 结果")?;
        Ok((output_text(&reply, true)?, usage_of(&reply)))
    } else if text.trim().is_empty() {
        Err("模型事件流没有返回文本内容".into())
    } else {
        Ok((text, usage))
    }
}

pub fn decode_reply(mut response: ureq::http::Response<ureq::Body>, responses: bool) -> Result<(Map<String, Value>, Value), String> {
    if !response.status().is_success() {
        let status = response.status().as_u16();
        let value = response.body_mut().with_config().limit(65536).read_json::<Value>().ok();
        let message = value.as_ref().and_then(error_message).unwrap_or("模型网关拒绝了请求");
        return Err(format!("HTTP {status} · {message}"));
    }
    let streaming = response.headers().get("Content-Type").and_then(|header| header.to_str().ok())
        .map(|header| header.to_ascii_lowercase().contains("text/event-stream")).unwrap_or(false);
    let (text, usage) = if streaming {
        decode_stream(response.body_mut().as_reader(), responses)?
    } else {
        let value: Value = response.body_mut().with_config().limit(RESPONSE_LIMIT).read_json().map_err(|_| "模型网关未返回有效 JSON".to_string())?;
        (output_text(&value, responses)?, usage_of(&value))
    };
    Ok((json_object(&text).or_else(|_| repair_json(&text).ok_or("模型返回的 JSON 无效".to_string()))?, usage))
}

/// JSON 修复：模型返回坏 JSON 时，尝试去掉代码块围栏、修复未闭合的字符串，再解析
fn repair_json(text: &str) -> Option<Map<String, Value>> {
    let mut s = text.trim().to_string();
    // 去掉 ```json ... ``` 或 ``` ... ``` 围栏
    if s.starts_with("```") {
        let first_nl = s.find('\n').unwrap_or(0);
        s = s[first_nl + 1..].trim().to_string();
        if let Some(end) = s.rfind("```") {
            s = s[..end].trim().to_string();
        }
    }
    // 去掉开头/结尾的多余文字（只保留第一个 { 到最后一个 }）
    let start = s.find('{')?;
    let end = s.rfind('}')?;
    if start > end { return None; }
    s = s[start..=end].to_string();
    // 尝试解析
    if let Ok(Value::Object(v)) = serde_json::from_str::<Value>(&s) {
        return Some(v);
    }
    // 修复常见问题：未闭合的双引号、尾逗号
    let repaired = s.replace(",}", "}").replace(",]", "]");
    if let Ok(Value::Object(v)) = serde_json::from_str::<Value>(&repaired) {
        return Some(v);
    }
    None
}

pub fn ask_json(base: &str, auth: &str, model: &str, system: &str, user: &str, options: ClientOptions, timeout: Duration) -> Result<(Map<String, Value>, Value), String> {
    let base = timeseen_core::network::validate_model_base(base)?;
    let (url, body) = options.request(&base, model, system, user);
    let result = (|| {
        let agent = agent(timeout);
        let mut request = agent.post(&url).header("Content-Type", "application/json").header("Authorization", auth)
            .header("Accept", "application/json, text/event-stream");
        for (name, value) in options.headers(&session_id()) { request = request.header(name, value); }
        let response = request.send_json(&body).map_err(|error| format!("模型连接失败：{error}"))?;
        decode_reply(response, options.responses)
    })();
    result.map_err(|error: String| error.replace(auth.trim_start_matches("Bearer "), "[密钥]"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codex_headers_keep_timeseen_attribution_and_never_contain_auth() {
        let headers = ClientOptions::new("codex", "responses").unwrap().headers("test-session");
        assert!(headers.iter().any(|(name, value)| *name == "User-Agent" && value.starts_with("codex_cli_rs/") && value.contains("TimeSeen/")));
        assert!(headers.iter().any(|(name, value)| *name == "originator" && value == "codex_cli_rs"));
        assert!(headers.iter().any(|(name, _)| *name == "x-codex-window-id"));
        assert!(!headers.iter().any(|(name, _)| name.eq_ignore_ascii_case("Authorization")));
        assert_eq!(ClientOptions::default().headers("test-session").len(), 1);
    }

    #[test]
    fn protocols_generate_distinct_payloads() {
        let (url, body) = ClientOptions::new("codex", "responses").unwrap().request("https://example.test/v1/", "model", "system", "user");
        assert_eq!(url, "https://example.test/v1/responses");
        assert_eq!(body["stream"], true);
        assert_eq!(body["store"], false);
        assert_eq!(body["instructions"], "system");
        assert!(body.get("messages").is_none());
        assert!(body.get("temperature").is_none());
        let (url, body) = ClientOptions::default().request("https://example.test/v1", "model", "system", "user");
        assert!(url.ends_with("/chat/completions"));
        assert_eq!(body["stream"], false);
    }

    #[test]
    fn responses_stream_requires_completed_event() {
        let response = json!({"status":"completed", "output":[{"type":"message","content":[{"type":"output_text","text":"{\"ok\":true}"}]}], "usage":{"input_tokens":3,"output_tokens":2}});
        let stream = format!("event: response.completed\r\ndata: {}\r\n\r\n", json!({"type":"response.completed", "response":response}));
        let (text, usage) = decode_stream(stream.as_bytes(), true).unwrap();
        assert_eq!(json_object(&text).unwrap()["ok"], true);
        assert_eq!(usage["prompt_tokens"], 3);
        assert!(decode_stream(b"data: {\"type\":\"response.output_text.delta\",\"delta\":\"partial\"}\n\n".as_slice(), true).is_err());
        assert!(decode_stream(b"data: [DONE]\n\n".as_slice(), true).is_err());
    }

    #[test]
    fn chat_stream_concatenates_deltas_and_propagates_failures() {
        let stream = format!("data: {}\n\ndata: {}\n\ndata: [DONE]\n\n",
            json!({"choices":[{"delta":{"content":"{\"ok\":"}}]}), json!({"choices":[{"delta":{"content":"true}"}}]}));
        let (text, _) = decode_stream(stream.as_bytes(), false).unwrap();
        assert_eq!(json_object(&text).unwrap()["ok"], true);
        let failed = format!("data: {}\n\n", json!({"type":"response.failed","response":{"error":{"message":"quota exhausted"}}}));
        assert_eq!(decode_stream(failed.as_bytes(), true).unwrap_err(), "quota exhausted");
    }

    #[test]
    fn accepts_completed_json_and_rejects_http_errors_and_incomplete_output() {
        let value = json!({"status":"completed", "output":[{"type":"message","content":[{"type":"output_text","text":"{\"summary\":\"done\"}"}]}]});
        let response = ureq::http::Response::builder().header("Content-Type", "application/json").body(ureq::Body::builder().data(value.to_string())).unwrap();
        assert_eq!(decode_reply(response, true).unwrap().0["summary"], "done");
        let response = ureq::http::Response::builder().status(403).body(ureq::Body::builder().data(json!({"error":{"message":"client not allowed"}}).to_string())).unwrap();
        assert_eq!(decode_reply(response, true).unwrap_err(), "HTTP 403 · client not allowed");
        let incomplete = json!({"status":"incomplete", "output":value["output"]});
        assert!(output_text(&incomplete, true).is_err());
        assert!(ClientOptions::from_settings(&serde_json::from_value(json!({"model_client":true})).unwrap()).is_err());
    }

    #[test]
    fn json_and_streaming_responses_use_the_same_decoder() {
        let response = json!({"status":"completed", "output":[{"type":"message","content":[{"type":"output_text","text":"{\"ok\":true}"}]}]});
        let event = format!("data: {}\n\n", json!({"type":"response.completed", "response":response}));
        let reply = ureq::http::Response::builder().header("Content-Type", "text/event-stream; charset=utf-8")
            .body(ureq::Body::builder().data(event)).unwrap();
        assert_eq!(decode_reply(reply, true).unwrap().0["ok"], true);
        let reply = ureq::http::Response::builder().header("Content-Type", "application/json")
            .body(ureq::Body::builder().data(json!({"error":{"message":"invalid codex request"}}).to_string())).unwrap();
        assert_eq!(decode_reply(reply, false).unwrap_err(), "invalid codex request");
    }
}

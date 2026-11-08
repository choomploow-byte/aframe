//! The in-app assistant's network and key handling (docs/08, docs/18).
//!
//! API keys live in the operating system's credential store (Windows Credential Manager, the macOS
//! Keychain, the Secret Service on Linux) and are read here only to put them in a request header.
//! They are never returned to the webview, never written to a file, never logged, and never part of
//! an error message. The webview sends a request *body*; this module chooses the address from a short
//! allow-list and adds the key, so a compromised page cannot send a key anywhere else.

use serde::Serialize;
use std::time::Duration;

const SERVICE: &str = "atelier-ai";
const MAX_KEY_LEN: usize = 512;
const MAX_BODY_BYTES: usize = 40 * 1024 * 1024;
const TIMEOUT: Duration = Duration::from_secs(240);

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Provider {
    Anthropic,
    OpenAi,
    Custom,
    /// The Figma personal access token (not an AI provider: only `figma.rs` reads it).
    Figma,
}

impl Provider {
    pub fn parse(id: &str) -> Result<Provider, String> {
        match id {
            "anthropic" => Ok(Provider::Anthropic),
            "openai" => Ok(Provider::OpenAi),
            "custom" => Ok(Provider::Custom),
            "figma" => Ok(Provider::Figma),
            _ => Err("unknown provider".into()),
        }
    }

    fn account(self) -> &'static str {
        match self {
            Provider::Anthropic => "anthropic",
            Provider::OpenAi => "openai",
            Provider::Custom => "custom",
            Provider::Figma => "figma",
        }
    }
}

fn entry(provider: Provider) -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, provider.account())
        .map_err(|_| "The system credential store is not available.".to_string())
}

pub fn key_present(provider: Provider) -> Result<bool, String> {
    match entry(provider)?.get_password() {
        Ok(k) => Ok(!k.is_empty()),
        Err(keyring::Error::NoEntry) => Ok(false),
        Err(_) => Err("The system credential store could not be read.".into()),
    }
}

pub fn key_set(provider: Provider, key: &str) -> Result<(), String> {
    let key = key.trim();
    if key.is_empty() || key.len() > MAX_KEY_LEN || key.chars().any(|c| c.is_control()) {
        return Err("That does not look like an API key.".into());
    }
    entry(provider)?
        .set_password(key)
        .map_err(|_| "The system credential store refused to save the key.".to_string())
}

/// The stored key, for the module that makes the request. Never sent to the page.
pub fn key_get(provider: Provider) -> Result<Option<String>, String> {
    match entry(provider)?.get_password() {
        Ok(k) if !k.is_empty() => Ok(Some(k)),
        Ok(_) | Err(keyring::Error::NoEntry) => Ok(None),
        Err(_) => Err("The system credential store could not be read.".into()),
    }
}

pub fn key_clear(provider: Provider) -> Result<(), String> {
    match entry(provider)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(_) => Err("The system credential store could not remove the key.".into()),
    }
}

/// The address a request goes to. Fixed for the two hosted providers; a custom server must be https,
/// or plain http only on this machine (Ollama, LM Studio).
pub fn endpoint(provider: Provider, base_url: Option<&str>) -> Result<String, String> {
    match provider {
        Provider::Figma => Err("That key is not for AI requests.".into()),
        Provider::Anthropic => Ok("https://api.anthropic.com/v1/messages".into()),
        Provider::OpenAi => Ok("https://api.openai.com/v1/chat/completions".into()),
        Provider::Custom => {
            let base = base_url.unwrap_or("").trim().trim_end_matches('/');
            if base.is_empty() {
                return Err("Enter the base URL of your server in Settings.".into());
            }
            let local = ["http://localhost", "http://127.0.0.1", "http://[::1]"]
                .iter()
                .any(|p| {
                    base.strip_prefix(p)
                        .is_some_and(|rest| rest.is_empty() || rest.starts_with([':', '/']))
                });
            if !(base.starts_with("https://") || local) {
                return Err(
                    "The base URL must start with https:// (http:// is only allowed for this computer).".into(),
                );
            }
            if base.contains(char::is_whitespace) || base.contains('@') {
                return Err("The base URL is not valid.".into());
            }
            Ok(format!("{base}/chat/completions"))
        }
    }
}

#[derive(Serialize, Debug, PartialEq)]
pub struct AiReply {
    pub status: u16,
    pub text: String,
}

/// Sends one request. Blocking: call from a blocking thread.
pub fn send(
    provider: Provider,
    base_url: Option<&str>,
    body: &serde_json::Value,
) -> Result<AiReply, String> {
    let url = endpoint(provider, base_url)?;
    let key = match entry(provider)?.get_password() {
        Ok(k) if !k.is_empty() => Some(k),
        Ok(_) | Err(keyring::Error::NoEntry) => None,
        // A local server may need no key, so a missing credential store must not stop it.
        Err(_) if provider == Provider::Custom => None,
        Err(_) => return Err("The system credential store could not be read.".into()),
    };
    if key.is_none() && provider != Provider::Custom {
        return Err("NO_KEY".into());
    }
    let bytes = serde_json::to_vec(body).map_err(|_| "The request could not be prepared.")?;
    if bytes.len() > MAX_BODY_BYTES {
        return Err("The conversation is too large to send. Start a new chat.".into());
    }
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_global(Some(TIMEOUT))
        .http_status_as_error(false)
        .build()
        .into();
    let mut request = agent.post(&url).header("content-type", "application/json");
    match (provider, key.as_deref()) {
        (Provider::Anthropic, Some(k)) => {
            request = request
                .header("x-api-key", k)
                .header("anthropic-version", "2023-06-01");
        }
        (_, Some(k)) => {
            request = request.header("authorization", &format!("Bearer {k}"));
        }
        _ => {}
    }
    // Errors from the HTTP library can echo the request; say only that the network failed.
    let mut response = request
        .send(&bytes[..])
        .map_err(|_| "NETWORK: the provider could not be reached".to_string())?;
    let status = response.status().as_u16();
    let text = response
        .body_mut()
        .with_config()
        .limit(MAX_BODY_BYTES as u64)
        .read_to_string()
        .map_err(|_| "NETWORK: the answer could not be read".to_string())?;
    Ok(AiReply { status, text })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hosted_providers_have_fixed_addresses_whatever_the_page_says() {
        assert_eq!(
            endpoint(Provider::Anthropic, Some("https://evil.example")).unwrap(),
            "https://api.anthropic.com/v1/messages"
        );
        assert_eq!(
            endpoint(Provider::OpenAi, Some("https://evil.example")).unwrap(),
            "https://api.openai.com/v1/chat/completions"
        );
    }

    #[test]
    fn a_custom_server_must_be_https_or_this_computer() {
        for ok in [
            "https://openrouter.ai/api/v1",
            "https://example.com/v1/",
            "http://localhost:11434/v1",
            "http://127.0.0.1:1234/v1",
            "http://localhost",
            "http://[::1]:8080/v1",
        ] {
            assert!(endpoint(Provider::Custom, Some(ok)).is_ok(), "{ok}");
        }
        for bad in [
            "",
            "   ",
            "http://example.com/v1",
            "http://localhost.evil.com/v1",
            "http://localhostx/v1",
            "ftp://localhost/v1",
            "https://user:pass@example.com/v1",
            "https://exa mple.com",
            "file:///etc/passwd",
            "javascript:alert(1)",
        ] {
            assert!(endpoint(Provider::Custom, Some(bad)).is_err(), "{bad}");
        }
        assert!(endpoint(Provider::Custom, None).is_err());
    }

    #[test]
    fn custom_addresses_end_in_the_chat_completions_path() {
        assert_eq!(
            endpoint(Provider::Custom, Some("https://openrouter.ai/api/v1/")).unwrap(),
            "https://openrouter.ai/api/v1/chat/completions"
        );
    }

    #[test]
    fn rejects_unknown_providers_and_odd_keys() {
        assert!(Provider::parse("gemini").is_err());
        assert!(Provider::parse("anthropic").is_ok());
        assert!(key_set(Provider::Anthropic, "").is_err());
        assert!(key_set(Provider::Anthropic, "   ").is_err());
        assert!(key_set(Provider::Anthropic, "sk\nabc").is_err());
        assert!(key_set(Provider::Anthropic, &"k".repeat(600)).is_err());
    }

    /// A small local HTTP server stands in for a provider: checks the headers the key goes in, that
    /// the body arrives intact and that the status and text come back. Uses the real credential
    /// store under a throwaway account, then removes it.
    #[test]
    fn sends_with_the_key_in_the_right_header_and_never_leaks_it() {
        use std::io::{Read, Write};
        use std::net::TcpListener;
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let seen = std::sync::Arc::new(std::sync::Mutex::new(String::new()));
        let seen2 = seen.clone();
        let server = std::thread::spawn(move || {
            let (mut s, _) = listener.accept().unwrap();
            let mut buf = vec![0u8; 65536];
            let mut got = Vec::new();
            loop {
                let n = s.read(&mut buf).unwrap();
                got.extend_from_slice(&buf[..n]);
                let text = String::from_utf8_lossy(&got).to_string();
                if let Some(h) = text.find("\r\n\r\n") {
                    let len: usize = text[..h]
                        .lines()
                        .find_map(|l| {
                            l.to_ascii_lowercase()
                                .strip_prefix("content-length:")
                                .map(|v| v.trim().parse().unwrap())
                        })
                        .unwrap_or(0);
                    if got.len() >= h + 4 + len {
                        break;
                    }
                }
            }
            *seen2.lock().unwrap() = String::from_utf8_lossy(&got).to_string();
            let body = r#"{"ok":true}"#;
            write!(
                s,
                "HTTP/1.1 429 Too Many Requests\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
                body.len(),
                body
            )
            .unwrap();
        });
        // The custom provider's account is used for the test; keep any key the user has.
        let previous = entry(Provider::Custom)
            .ok()
            .and_then(|e| e.get_password().ok());
        if key_set(Provider::Custom, "test-secret-key-123").is_err() {
            eprintln!("SKIPPED: no credential store here");
            return;
        }
        let base = format!("http://127.0.0.1:{port}/v1");
        let reply = send(
            Provider::Custom,
            Some(&base),
            &serde_json::json!({"hello": "world"}),
        );
        match previous {
            Some(k) => key_set(Provider::Custom, &k).unwrap(),
            None => key_clear(Provider::Custom).unwrap(),
        }
        server.join().unwrap();
        let reply = reply.unwrap();
        assert_eq!(reply.status, 429);
        assert_eq!(reply.text, r#"{"ok":true}"#);
        let request = seen.lock().unwrap().clone();
        assert!(
            request.starts_with("POST /v1/chat/completions"),
            "{request}"
        );
        assert!(request
            .to_ascii_lowercase()
            .contains("authorization: bearer test-secret-key-123"));
        assert!(request.contains(r#"{"hello":"world"}"#));
    }

    #[test]
    fn a_network_failure_does_not_echo_the_request() {
        // Nothing listens on this port.
        let err = send(
            Provider::Custom,
            Some("http://127.0.0.1:9/v1"),
            &serde_json::json!({"secret": "payload"}),
        )
        .unwrap_err();
        assert!(err.starts_with("NETWORK"), "{err}");
        assert!(!err.contains("payload"));
    }
}

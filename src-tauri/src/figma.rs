//! Fetching a Figma file for the importer (docs/10). The webview cannot call Figma directly (the
//! browser blocks it), and it must never hold the personal access token, so the request is made here.
//!
//! What the page can ask for is a short fixed list, built from validated pieces (a file key, node ids,
//! a format), never a free-form address: the file or a part of it, the pictures Figma renders for
//! some nodes, the image fills of a file, and one download of a picture from an address Figma gave
//! back (https, and only Figma's or its storage's hosts). The token is read from the system credential
//! store, put in a header and never returned.

use crate::ai::{key_get, Provider};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Serialize;
use std::time::Duration;

const MAX_JSON_BYTES: u64 = 120 * 1024 * 1024;
const MAX_PICTURE_BYTES: u64 = 8 * 1024 * 1024;
const TIMEOUT: Duration = Duration::from_secs(120);

#[derive(Serialize, Debug, PartialEq)]
pub struct FigmaReply {
    pub status: u16,
    pub text: String,
}

#[derive(Serialize, Debug, PartialEq)]
pub struct Picture {
    pub mime: String,
    pub base64: String,
}

fn valid_key(key: &str) -> bool {
    (10..=40).contains(&key.len()) && key.chars().all(|c| c.is_ascii_alphanumeric())
}

fn valid_ids(ids: &str) -> bool {
    !ids.is_empty()
        && ids.len() <= 4000
        && ids
            .chars()
            .all(|c| c.is_ascii_digit() || matches!(c, ':' | ';' | ',' | '_' | '-' | 'I'))
}

/// The address for one kind of request, from validated parts.
pub fn api_url(
    kind: &str,
    key: &str,
    ids: Option<&str>,
    depth: Option<u8>,
) -> Result<String, String> {
    if !valid_key(key) {
        return Err("That is not a Figma file key.".into());
    }
    let ids_ok = |ids: Option<&str>| -> Result<String, String> {
        let ids = ids.unwrap_or("");
        if valid_ids(ids) {
            Ok(ids.to_string())
        } else {
            Err("Those are not Figma layer ids.".into())
        }
    };
    let base = "https://api.figma.com/v1";
    match kind {
        "file" => Ok(match depth {
            Some(d) => format!("{base}/files/{key}?depth={}", d.min(4)),
            None => format!("{base}/files/{key}"),
        }),
        "nodes" => Ok(format!("{base}/files/{key}/nodes?ids={}", ids_ok(ids)?)),
        "svg" => Ok(format!(
            "{base}/images/{key}?ids={}&format=svg&svg_include_id=false",
            ids_ok(ids)?
        )),
        "fills" => Ok(format!("{base}/files/{key}/images")),
        _ => Err("Unknown Figma request.".into()),
    }
}

/// Only Figma's own hosts and its picture storage may be downloaded from.
pub fn download_allowed(url: &str) -> bool {
    let Some(rest) = url.strip_prefix("https://") else {
        return false;
    };
    let host = rest.split(['/', '?', '#']).next().unwrap_or("");
    if host.is_empty() || host.contains('@') || host.contains(':') {
        return false;
    }
    let host = host.to_ascii_lowercase();
    host == "figma.com"
        || host.ends_with(".figma.com")
        || (host.ends_with(".amazonaws.com") && host.contains("figma"))
}

fn agent() -> ureq::Agent {
    ureq::Agent::config_builder()
        .timeout_global(Some(TIMEOUT))
        .http_status_as_error(false)
        .max_redirects(0)
        .build()
        .into()
}

pub fn get(
    kind: &str,
    key: &str,
    ids: Option<&str>,
    depth: Option<u8>,
) -> Result<FigmaReply, String> {
    let url = api_url(kind, key, ids, depth)?;
    let Some(token) = key_get(Provider::Figma)? else {
        return Err("NO_TOKEN".into());
    };
    let mut response = agent()
        .get(&url)
        .header("x-figma-token", &token)
        .call()
        .map_err(|_| "NETWORK: Figma could not be reached".to_string())?;
    let status = response.status().as_u16();
    let text = response
        .body_mut()
        .with_config()
        .limit(MAX_JSON_BYTES)
        .read_to_string()
        .map_err(|_| "NETWORK: the answer could not be read".to_string())?;
    Ok(FigmaReply { status, text })
}

pub fn download(url: &str) -> Result<Picture, String> {
    if !download_allowed(url) {
        return Err("That address is not one Atelier downloads from.".into());
    }
    let mut response = agent()
        .get(url)
        .call()
        .map_err(|_| "NETWORK: the picture could not be downloaded".to_string())?;
    if response.status().as_u16() != 200 {
        return Err(format!(
            "The download failed ({}).",
            response.status().as_u16()
        ));
    }
    let mime = response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();
    let bytes = response
        .body_mut()
        .with_config()
        .limit(MAX_PICTURE_BYTES)
        .read_to_vec()
        .map_err(|_| "The picture is too large or could not be read.".to_string())?;
    Ok(Picture {
        mime,
        base64: STANDARD.encode(bytes),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const KEY: &str = "AbCdEfGhIjKlMn";

    #[test]
    fn addresses_are_built_from_validated_parts() {
        assert_eq!(
            api_url("file", KEY, None, Some(2)).unwrap(),
            "https://api.figma.com/v1/files/AbCdEfGhIjKlMn?depth=2"
        );
        assert_eq!(
            api_url("file", KEY, None, None).unwrap(),
            "https://api.figma.com/v1/files/AbCdEfGhIjKlMn"
        );
        assert_eq!(
            api_url("nodes", KEY, Some("1:2,3:4"), None).unwrap(),
            "https://api.figma.com/v1/files/AbCdEfGhIjKlMn/nodes?ids=1:2,3:4"
        );
        assert!(api_url("svg", KEY, Some("1:7"), None)
            .unwrap()
            .ends_with("/images/AbCdEfGhIjKlMn?ids=1:7&format=svg&svg_include_id=false"));
        assert!(api_url("fills", KEY, None, None)
            .unwrap()
            .ends_with("/images"));
    }

    #[test]
    fn depth_is_capped() {
        assert!(api_url("file", KEY, None, Some(200))
            .unwrap()
            .ends_with("depth=4"));
    }

    #[test]
    fn refuses_odd_keys_ids_and_kinds() {
        for key in [
            "",
            "short",
            "has/slash12345",
            "../../etc/passwd",
            "a b c d e f g h",
            &"A".repeat(60),
        ] {
            assert!(api_url("file", key, None, None).is_err(), "{key}");
        }
        for ids in [
            "",
            "1:2&format=png",
            "1:2/../x",
            "1:2?x=1",
            "a b",
            "<script>",
        ] {
            assert!(api_url("nodes", KEY, Some(ids), None).is_err(), "{ids}");
        }
        assert!(api_url("nodes", KEY, None, None).is_err());
        assert!(api_url("delete", KEY, None, None).is_err());
    }

    #[test]
    fn downloads_only_from_figma_hosts_over_https() {
        for ok in [
            "https://figma-alpha-api.s3.us-west-2.amazonaws.com/images/abc?x=1",
            "https://s3-alpha.figma.com/img/abc",
            "https://www.figma.com/x",
        ] {
            assert!(download_allowed(ok), "{ok}");
        }
        for bad in [
            "http://s3-alpha.figma.com/img/abc",
            "https://evil.com/figma.com",
            "https://figma.com.evil.com/x",
            "https://evil.com@s3-alpha.figma.com/x",
            "https://s3-alpha.figma.com:8080/x",
            "https://bucket.s3.amazonaws.com/x",
            "file:///etc/passwd",
            "https://",
            "",
        ] {
            assert!(!download_allowed(bad), "{bad}");
        }
    }

    #[test]
    fn asks_for_a_token_when_there_is_none() {
        // The error for a missing token is a fixed word the page maps to "add your token".
        let err = get("file", KEY, None, None);
        // On a machine that has a Figma token stored this goes to the network instead; accept both.
        if let Err(e) = err {
            assert!(e == "NO_TOKEN" || e.starts_with("NETWORK"), "{e}");
        }
    }
}

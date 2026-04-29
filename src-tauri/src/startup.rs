#[cfg(any(target_os = "linux", test))]
fn is_wayland_session<F>(get_var: F) -> bool
where
    F: Fn(&str) -> Option<String>,
{
    let wayland_display = get_var("WAYLAND_DISPLAY")
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false);
    let wayland_session = get_var("XDG_SESSION_TYPE")
        .map(|value| value.eq_ignore_ascii_case("wayland"))
        .unwrap_or(false);

    wayland_display || wayland_session
}

#[cfg(target_os = "linux")]
pub fn configure_runtime_environment() {
    if is_wayland_session(|key| std::env::var(key).ok()) {
        if std::env::var("WEBKIT_DISABLE_COMPOSITING_MODE").is_err() {
            // Official Tauri Linux docs mention this WebKitGTK workaround for Wayland rendering issues.
            std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
        }
        if std::env::var("WEBKIT_DISABLE_DMABUF_RENDERER").is_err() {
            std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        }
    }
}

#[cfg(not(target_os = "linux"))]
pub fn configure_runtime_environment() {}

#[cfg(test)]
mod tests {
    use super::is_wayland_session;
    use std::collections::HashMap;

    fn decide(vars: &[(&str, &str)]) -> bool {
        let env = vars
            .iter()
            .map(|(key, value)| ((*key).to_string(), (*value).to_string()))
            .collect::<HashMap<_, _>>();

        is_wayland_session(|key| env.get(key).cloned())
    }

    #[test]
    fn enables_workaround_for_wayland_display() {
        assert!(decide(&[("WAYLAND_DISPLAY", "wayland-0")]));
    }

    #[test]
    fn enables_workaround_for_wayland_session_type() {
        assert!(decide(&[("XDG_SESSION_TYPE", "wayland")]));
    }

    #[test]
    fn does_not_enable_workaround_on_non_wayland_sessions() {
        assert!(!decide(&[("DISPLAY", ":0"), ("XDG_SESSION_TYPE", "x11")]));
    }
}

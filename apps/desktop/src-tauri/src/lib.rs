use std::io::{BufRead, BufReader};
use std::net::TcpListener;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};

const PREFERRED_PORT: u16 = 4123;
const FALLBACK_WS: &str = "ws://127.0.0.1:4123";

struct Sidecar {
    child: Mutex<Option<Child>>,
    ws_url: Arc<Mutex<Option<String>>>,
}

fn free_port() -> u16 {
    TcpListener::bind(("127.0.0.1", PREFERRED_PORT))
        .or_else(|_| TcpListener::bind(("127.0.0.1", 0)))
        .and_then(|listener| listener.local_addr())
        .map(|addr| addr.port())
        .unwrap_or(PREFERRED_PORT)
}

fn sidecar_command() -> Command {
    if let Ok(entry) = std::env::var("ORCHESTRATOR_SIDECAR_ENTRY") {
        let mut cmd = Command::new("node");
        cmd.arg(entry);
        return cmd;
    }
    let manifest = env!("CARGO_MANIFEST_DIR");
    let entry = format!("{manifest}/../../../services/sidecar/dist/index.js");
    let mut cmd = Command::new("node");
    cmd.arg(entry);
    cmd
}

fn spawn_sidecar(workspace: &str, port: u16, ws_url: Arc<Mutex<Option<String>>>) -> std::io::Result<Child> {
    let mut child = sidecar_command()
        .env("ORCHESTRATOR_PORT", port.to_string())
        .env("ORCHESTRATOR_WORKSPACE", workspace)
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()?;

    if let Some(stdout) = child.stdout.take() {
        std::thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines().map_while(Result::ok) {
                if let Some(url) = line.strip_prefix("ORCHESTRATOR_WS=") {
                    if let Ok(mut guard) = ws_url.lock() {
                        *guard = Some(url.trim().to_string());
                    }
                }
                println!("[sidecar] {line}");
            }
        });
    }
    Ok(child)
}

#[tauri::command]
fn sidecar_url(state: tauri::State<Sidecar>) -> String {
    state
        .ws_url
        .lock()
        .ok()
        .and_then(|guard| guard.clone())
        .unwrap_or_else(|| FALLBACK_WS.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let workspace = std::env::var("ORCHESTRATOR_WORKSPACE")
        .unwrap_or_else(|_| std::env::current_dir().unwrap_or_default().display().to_string());

    let port = free_port();
    let ws_url = Arc::new(Mutex::new(None));
    let child = spawn_sidecar(&workspace, port, ws_url.clone()).ok();
    let setup_url = ws_url.clone();

    tauri::Builder::default()
        .manage(Sidecar {
            child: Mutex::new(child),
            ws_url,
        })
        .invoke_handler(tauri::generate_handler![sidecar_url])
        .setup(move |app| {
            let mut url = format!("ws://127.0.0.1:{port}");
            for _ in 0..60 {
                if let Ok(guard) = setup_url.lock() {
                    if let Some(found) = guard.as_ref() {
                        url = found.clone();
                        break;
                    }
                }
                std::thread::sleep(Duration::from_millis(100));
            }

            let script = format!(
                "window.__ORCHESTRATOR_WS__ = {};",
                serde_json::to_string(&url).unwrap_or_else(|_| format!("\"{FALLBACK_WS}\""))
            );

            WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
                .title("Orchestrator")
                .inner_size(1440.0, 900.0)
                .min_inner_size(960.0, 600.0)
                .decorations(false)
                .background_color(tauri::window::Color(11, 13, 16, 255))
                .initialization_script(script)
                .build()?;

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let RunEvent::ExitRequested { .. } | RunEvent::Exit = event {
                if let Some(state) = app_handle.try_state::<Sidecar>() {
                    if let Ok(mut guard) = state.child.lock() {
                        if let Some(mut child) = guard.take() {
                            let _ = child.kill();
                        }
                    }
                }
            }
        });
}

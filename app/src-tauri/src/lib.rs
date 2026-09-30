// Enveloppe desktop de Misogi : une fenêtre étroite ancrée au bord de l'écran, qui charge l'interface
// servie par le serveur local Node (hooks/bundle/cli.js, embarqué dans les ressources).
// Toute la logique (journal, sessions, installation des hooks, trousseau) reste côté Node.

use std::net::TcpStream;
use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::menu::{CheckMenuItem, Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, RunEvent, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

const PORT: u16 = 4317;
/// Largeur par défaut de la fenêtre, en pixels logiques.
const WIDTH: f64 = 380.0;
/// Largeur du mode réduit.
const STRIP: f64 = 40.0;

struct Sidecar(Mutex<Option<Child>>);
/// Largeur (physique) avant réduction, pour la retrouver en redéployant.
struct Expanded(Mutex<Option<u32>>);

fn err<E: ToString>(e: E) -> String {
    e.to_string()
}

/// Passe en bande de 40 px (ou revient), en restant collé au bord droit si la fenêtre y est ancrée.
#[tauri::command]
fn set_collapsed(window: WebviewWindow, expanded: State<Expanded>, collapsed: bool) -> Result<(), String> {
    let scale = window.scale_factor().map_err(err)?;
    let size = window.outer_size().map_err(err)?;
    let pos = window.outer_position().map_err(err)?;
    let right_edge = window
        .current_monitor()
        .map_err(err)?
        .map(|m| m.position().x + m.size().width as i32)
        .unwrap_or(i32::MAX);
    let docked_right = pos.x + size.width as i32 >= right_edge - 8;

    let mut saved = expanded.0.lock().map_err(err)?;
    let width = if collapsed {
        *saved = Some(size.width);
        (STRIP * scale) as u32
    } else {
        // Sans largeur mémorisée (ex. fenêtre rouverte après une fermeture en mode bande) : on garde la
        // largeur actuelle si elle est normale, sinon on revient à la largeur par défaut.
        saved.take().unwrap_or(if (size.width as f64) / scale >= 200.0 { size.width } else { (WIDTH * scale) as u32 })
    };
    let inner = window.inner_size().map_err(err)?;
    window.set_size(PhysicalSize::new(width, inner.height)).map_err(err)?;
    if docked_right {
        window.set_position(PhysicalPosition::new(right_edge - width as i32, pos.y)).map_err(err)?;
    }
    Ok(())
}

#[tauri::command]
fn set_always_on_top(window: WebviewWindow, on: bool) -> Result<(), String> {
    window.set_always_on_top(on).map_err(err)
}

fn server_up() -> bool {
    TcpStream::connect_timeout(&([127, 0, 0, 1], PORT).into(), Duration::from_millis(150)).is_ok()
}

/// Windows renvoie parfois des chemins \\?\C:\... que Git Bash (utilisé par Kimi) ne comprend pas.
fn plain_path(p: PathBuf) -> PathBuf {
    let s = p.to_string_lossy();
    match s.strip_prefix(r"\\?\") {
        Some(rest) => PathBuf::from(rest),
        None => p,
    }
}

/// Les applis graphiques macOS n'héritent pas du PATH du shell : on essaie aussi les emplacements courants.
fn node_candidates() -> Vec<&'static str> {
    vec!["node", "/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node"]
}

fn start_server(app: &AppHandle) -> Option<Child> {
    if server_up() {
        return None; // `misogi serve` tourne déjà
    }
    let dir = plain_path(app.path().resource_dir().ok()?.join("misogi"));
    for node in node_candidates() {
        let mut cmd = Command::new(node);
        cmd.arg(dir.join("cli.js"))
            .args(["serve", "--port", &PORT.to_string(), "--static"])
            .arg(dir.join("ui"));
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        }
        if let Ok(child) = cmd.spawn() {
            return Some(child);
        }
    }
    None
}

fn toggle(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        if w.is_visible().unwrap_or(false) {
            let _ = w.hide();
        } else {
            let _ = w.show();
        }
    }
}

fn create_window(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    let deadline = Instant::now() + Duration::from_secs(5);
    while !server_up() && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(100));
    }
    // Sans serveur (Node absent), l'interface embarquée s'ouvre et affiche comment le lancer.
    let url = match std::env::var("MISOGI_DEV_URL") {
        Ok(dev) => WebviewUrl::External(dev.parse().expect("MISOGI_DEV_URL invalide")),
        Err(_) if server_up() => WebviewUrl::External(format!("http://127.0.0.1:{PORT}").parse().unwrap()),
        Err(_) => WebviewUrl::App("index.html".into()),
    };

    let mut builder = WebviewWindowBuilder::new(app, "main", url)
        .title("Misogi")
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .focused(false)
        .resizable(true)
        .min_inner_size(STRIP, 200.0);

    // Premier lancement : ancrée au bord droit, pleine hauteur. Ensuite, window-state restaure écran, bord et taille.
    if let Some(m) = app.primary_monitor()? {
        let scale = m.scale_factor();
        let (w, h) = (m.size().width as f64 / scale, m.size().height as f64 / scale);
        let (x, y) = (m.position().x as f64 / scale, m.position().y as f64 / scale);
        builder = builder.inner_size(WIDTH, h).position(x + w - WIDTH, y);
    } else {
        builder = builder.inner_size(WIDTH, 800.0);
    }
    builder.build()
}

fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    let toggle_item = MenuItem::with_id(app, "toggle", "Afficher / masquer", true, None::<&str>)?;
    let on_top = CheckMenuItem::with_id(app, "on_top", "Toujours au-dessus", true, true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quitter Misogi", true, None::<&str>)?;
    let update = MenuItem::with_id(app, "update", "Rechercher une mise à jour", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&toggle_item, &on_top, &update, &quit])?;
    let on_top_handle = on_top.clone();

    let mut tray = TrayIconBuilder::with_id("misogi")
        .tooltip("Misogi")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, event| match event.id.as_ref() {
            "toggle" => toggle(app),
            "on_top" => {
                if let Some(w) = app.get_webview_window("main") {
                    let on = on_top_handle.is_checked().unwrap_or(true);
                    let _ = w.set_always_on_top(on);
                }
            }
            "update" => {
                let app = app.clone();
                tauri::async_runtime::spawn(async move { check_update(app, true).await });
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                toggle(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

/// Mises à jour signées (clé publique dans tauri.conf.json, clé privée seulement dans les secrets GitHub) :
/// au démarrage on vérifie et on prévient ; l'installation se lance depuis le menu de la barre des tâches.
async fn check_update(app: AppHandle, install: bool) {
    use tauri_plugin_notification::NotificationExt;
    use tauri_plugin_updater::UpdaterExt;
    let notify = |body: String| {
        let _ = app.notification().builder().title("Misogi").body(body).show();
    };
    let Ok(updater) = app.updater() else { return };
    match updater.check().await {
        Ok(Some(update)) if install => {
            notify(format!("Installation de Misogi {}…", update.version));
            if update.download_and_install(|_, _| {}, || {}).await.is_ok() {
                app.restart();
            } else {
                notify("La mise à jour n'a pas pu être installée.".into());
            }
        }
        Ok(Some(update)) => notify(format!("Misogi {} est disponible : menu de l'icône → « Rechercher une mise à jour ».", update.version)),
        Ok(None) if install => notify("Misogi est à jour.".into()),
        Err(_) if install => notify("Impossible de vérifier les mises à jour (hors ligne ?).".into()),
        _ => {}
    }
}

/// Démarrage avec le système : activé une fois au premier lancement, l'utilisateur garde la main ensuite.
fn enable_autostart_once(app: &AppHandle) {
    use tauri_plugin_autostart::ManagerExt;
    let Ok(dir) = app.path().app_config_dir() else { return };
    let marker = dir.join("autostart-initialised");
    if marker.exists() {
        return;
    }
    let _ = app.autolaunch().enable();
    let _ = std::fs::create_dir_all(&dir);
    let _ = std::fs::write(marker, "1");
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "macos")]
    let toggle_shortcut = Shortcut::new(Some(Modifiers::SUPER | Modifiers::SHIFT), Code::KeyM);
    #[cfg(not(target_os = "macos"))]
    let toggle_shortcut = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyM);

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
            }
        }))
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, None))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, shortcut, event| {
                    if shortcut == &toggle_shortcut && event.state() == ShortcutState::Pressed {
                        toggle(app);
                    }
                })
                .build(),
        )
        .manage(Sidecar(Mutex::new(None)))
        .manage(Expanded(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![set_collapsed, set_always_on_top])
        .setup(move |app| {
            let handle = app.handle().clone();
            *app.state::<Sidecar>().0.lock().unwrap() = start_server(&handle);
            create_window(&handle)?;
            setup_tray(&handle)?;
            let _ = handle.global_shortcut().register(toggle_shortcut);
            enable_autostart_once(&handle);
            let updates = handle.clone();
            tauri::async_runtime::spawn(async move { check_update(updates, false).await });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("impossible de démarrer Misogi");

    app.run(|app, event| {
        if let RunEvent::Exit = event {
            if let Some(mut child) = app.state::<Sidecar>().0.lock().unwrap().take() {
                let _ = child.kill();
            }
        }
    });
}

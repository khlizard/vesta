//! Tauri entry point: command wiring only. Logic lives in the modules.

mod clipboard;
mod com;
mod config;
mod context_menu;
mod dragdrop;
mod droptarget;
mod fileops;
mod icons;
mod launch;
mod listing;
mod location;
mod logfile;
mod path;
mod startup;
mod store;
mod types;
mod update;
mod watcher;
mod window_state;

use tauri::{Emitter, Manager, WebviewWindow};
use types::{ClipFiles, DiskFree, FileOp, FolderInfo, Listing, Modifiers, OpResult, Resolved};

fn owner(window: &WebviewWindow) -> isize {
    com::hwnd_of(window).map(|h| h.0 as isize).unwrap_or(0)
}

#[tauri::command]
async fn list_folder(location: String, show_hidden: bool) -> Result<Listing, String> {
    com::list_pool()
        .run(move || listing::list(&location, show_hidden))
        .await?
}

#[tauri::command]
async fn resolve_location(input: String) -> Result<Resolved, String> {
    com::list_pool().run(move || location::resolve(&input)).await?
}

/// The folder a shortcut points to, or null (not a shortcut, or it points to a file).
#[tauri::command]
async fn link_folder(location: String) -> Result<Option<FolderInfo>, String> {
    com::list_pool().run(move || location::link_folder(&location)).await
}

#[tauri::command]
async fn folder_ancestors(location: String) -> Result<Vec<FolderInfo>, String> {
    com::list_pool()
        .run(move || location::ancestors(&location))
        .await?
}

#[tauri::command]
async fn disk_free(location: String) -> Result<Option<DiskFree>, String> {
    com::list_pool()
        .run(move || listing::disk_free(&location))
        .await
}

#[tauri::command]
async fn watch_folders(app: tauri::AppHandle, locations: Vec<String>, fresh: bool) -> Result<(), String> {
    app.state::<watcher::Watcher>().request(locations, fresh);
    tauri::async_runtime::spawn_blocking(move || app.state::<watcher::Watcher>().apply())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn open_items(
    window: WebviewWindow,
    locations: Vec<String>,
    verb: Option<String>,
    args: Option<String>,
    cwd: Option<String>,
) -> Result<(), String> {
    launch::open(locations, verb, args, cwd, owner(&window)).await
}

#[tauri::command]
fn key_state() -> Modifiers {
    launch::key_state()
}

#[tauri::command]
async fn file_op(window: WebviewWindow, op: FileOp) -> Result<OpResult, String> {
    fileops::execute(op, owner(&window)).await
}

#[tauri::command]
async fn undo(window: WebviewWindow) -> Result<Option<String>, String> {
    fileops::undo(owner(&window)).await
}

#[tauri::command]
async fn clipboard_set_files(paths: Vec<String>, cut: bool) -> Result<(), String> {
    clipboard::set_files(paths, cut).await
}

#[tauri::command]
async fn clipboard_get_files() -> Result<Option<ClipFiles>, String> {
    clipboard::get_files().await
}

#[tauri::command]
async fn clipboard_clear() -> Result<(), String> {
    clipboard::clear().await
}

#[tauri::command]
async fn clipboard_set_text(text: String) -> Result<(), String> {
    clipboard::set_text(text).await
}

#[tauri::command]
async fn show_context_menu(
    window: WebviewWindow,
    folder: String,
    items: Vec<String>,
    x: f64,
    y: f64,
) -> Result<Option<String>, String> {
    context_menu::show(window, folder, items, x, y).await
}

#[tauri::command]
async fn start_drag(window: WebviewWindow, locations: Vec<String>) -> Result<String, String> {
    dragdrop::start_drag(window, locations).await
}

/// A right-button drop: the Shell shows its drop menu and does what is chosen.
#[tauri::command]
async fn right_drop(
    window: WebviewWindow,
    sources: Vec<String>,
    folder: String,
    x: f64,
    y: f64,
) -> Result<(), String> {
    droptarget::right_drop(window, sources, folder, x, y).await
}

// File access runs off the main thread: the data folder may sit on a slow or offline share.
#[tauri::command]
async fn read_state(app: tauri::AppHandle, name: String) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || store::read_state(&app, &name))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn write_state(app: tauri::AppHandle, name: String, json: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || store::write_state(&app, &name, &json))
        .await
        .map_err(|e| e.to_string())?
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct UiConfigResponse {
    config: config::UiConfig,
    warnings: Vec<String>,
    usr_dir: String,
}

#[tauri::command]
async fn get_ui_config(app: tauri::AppHandle) -> Result<UiConfigResponse, String> {
    tauri::async_runtime::spawn_blocking(move || match store::usr_dir(&app) {
        Ok(usr) => {
            let (config, warnings) = config::load(&usr);
            UiConfigResponse { config, warnings, usr_dir: usr.to_string_lossy().into_owned() }
        }
        // No settings folder (it cannot be created): the app still gets its menus and keys.
        Err(e) => UiConfigResponse {
            config: config::defaults(),
            warnings: vec![format!("usr: {e}; using the built-in settings")],
            usr_dir: String::new(),
        },
    })
    .await
    .map_err(|e| e.to_string())
}

/// Expands `%NAME%` environment variables (args of execute / link items).
#[tauri::command]
fn expand_env(text: String) -> String {
    location::expand_env(&text)
}

/// Folders and files named on the command line of this (first) instance.
#[tauri::command]
fn startup_paths() -> Vec<String> {
    let cwd = std::env::current_dir().unwrap_or_default();
    startup::paths_from_args(std::env::args().skip(1), &cwd)
}

/// Current placement of the main window, for the frontend to store in the session.
#[tauri::command]
fn window_placement(window: WebviewWindow) -> Result<window_state::Placement, String> {
    window_state::placement(&window)
}

/// Checks GitHub Releases and downloads a newer version; the version ready to apply, or null.
#[tauri::command]
async fn update_check() -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(update::check_and_download)
        .await
        .map_err(|e| e.to_string())?
}

/// Applies the downloaded update and restarts (the process exits).
#[tauri::command]
async fn update_restart() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(update::restart_now)
        .await
        .map_err(|e| e.to_string())?
}

pub fn run() {
    update::startup();
    tauri::Builder::default()
        // Must be the first plugin: a second start hands its arguments over and exits.
        .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            let paths = startup::paths_from_args(argv.into_iter().skip(1), std::path::Path::new(&cwd));
            let _ = app.emit("open-paths", paths);
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .register_asynchronous_uri_scheme_protocol("icon", |_ctx, request, responder| {
            com::icon_pool().spawn(move || responder.respond(icons::icon_response(&request)));
        })
        .register_asynchronous_uri_scheme_protocol("thumb", |_ctx, request, responder| {
            com::icon_pool().spawn(move || responder.respond(icons::thumb_response(&request)));
        })
        .setup(|app| {
            if let Ok(dir) = app.path().app_config_dir() {
                startup::install_panic_hook(dir.join("var"));
                logfile::set_dir(dir.join("var"));
                location::set_avesta_dir(dir);
            }
            app.manage(watcher::Watcher::new(app.handle().clone()));
            if let Some(window) = app.get_webview_window("main") {
                let text = store::read_state(app.handle(), "session").ok().flatten();
                window_state::restore(&window, text.as_deref());
                let _ = window.show();
                context_menu::install(&window)?;
                dragdrop::install(&window)?;
                // Not fatal: without it nothing can be dropped on the window, the rest works.
                if let Err(e) = droptarget::install(&window) {
                    logfile::line(&format!("drop target: {e}"));
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_folder,
            resolve_location,
            folder_ancestors,
            disk_free,
            watch_folders,
            open_items,
            key_state,
            file_op,
            undo,
            clipboard_set_files,
            clipboard_get_files,
            clipboard_set_text,
            clipboard_clear,
            show_context_menu,
            start_drag,
            right_drop,
            read_state,
            write_state,
            get_ui_config,
            update_check,
            update_restart,
            window_placement,
            expand_env,
            link_folder,
            startup_paths,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app, event| {
            if let tauri::RunEvent::Exit = event {
                update::apply_on_exit();
            }
        });
}

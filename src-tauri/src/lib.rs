//! Tauri entry point: command wiring only. Logic lives in the modules.

mod clipboard;
mod com;
mod config;
mod context_menu;
mod dataobject;
mod dragdrop;
mod droptarget;
mod fileops;
mod icons;
mod launch;
mod listing;
mod location;
mod logfile;
mod path;
mod shelldrop;
mod startup;
mod store;
mod types;
mod update;
mod watcher;
mod window_state;

use com::Hwnd;
use tauri::{Emitter, Manager, WebviewWindow};
use types::{ClipFiles, DiskFree, FileOp, FolderInfo, Listing, Modifiers, OpResult, Resolved};

#[tauri::command]
async fn list_folder(location: String, show_hidden: bool) -> Result<Listing, String> {
    listing::list_async(location, show_hidden).await
}

#[tauri::command]
async fn resolve_location(input: String) -> Result<Resolved, String> {
    location::resolve_async(input).await
}

/// The folder a shortcut points to, or null (not a shortcut, or it points to a file).
#[tauri::command]
async fn link_folder(location: String) -> Result<Option<FolderInfo>, String> {
    location::link_folder_async(location).await
}

#[tauri::command]
async fn folder_ancestors(location: String) -> Result<Vec<FolderInfo>, String> {
    location::ancestors_async(location).await
}

#[tauri::command]
async fn disk_free(location: String) -> Result<Option<DiskFree>, String> {
    listing::disk_free_async(location).await
}

#[tauri::command]
async fn watch_folders(app: tauri::AppHandle, locations: Vec<String>, fresh: bool) -> Result<(), String> {
    watcher::watch(app, locations, fresh).await
}

#[tauri::command]
async fn open_items(
    window: WebviewWindow,
    locations: Vec<String>,
    verb: Option<String>,
    args: Option<String>,
    cwd: Option<String>,
) -> Result<(), String> {
    launch::open(locations, verb, args, cwd, Hwnd::of_or_none(&window)).await
}

#[tauri::command]
fn key_state() -> Modifiers {
    launch::key_state()
}

#[tauri::command]
async fn file_op(window: WebviewWindow, op: FileOp) -> Result<OpResult, String> {
    fileops::execute(op, Hwnd::of_or_none(&window)).await
}

#[tauri::command]
async fn undo(window: WebviewWindow) -> Result<Option<String>, String> {
    fileops::undo(Hwnd::of_or_none(&window)).await
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
async fn right_drop(window: WebviewWindow, sources: Vec<String>, folder: String, x: f64, y: f64) -> Result<(), String> {
    shelldrop::right_drop(window, sources, folder, x, y).await
}

/// A drop on a program or a shortcut: the Shell's drop target of that item takes it.
#[tauri::command]
async fn drop_on_item(
    window: WebviewWindow,
    sources: Vec<String>,
    item: String,
    x: f64,
    y: f64,
    right_button: bool,
) -> Result<(), String> {
    shelldrop::drop_on_item(window, sources, item, x, y, right_button).await
}

// File access from commands runs off the main thread: the data folder may sit on a slow or
// offline share. (`setup` reads session.json once on the main thread, before the window shows.)
#[tauri::command]
async fn read_state(app: tauri::AppHandle, name: String) -> Result<Option<String>, String> {
    com::blocking(move || store::read_state(&app, &name)).await?
}

#[tauri::command]
async fn write_state(app: tauri::AppHandle, name: String, json: String) -> Result<(), String> {
    com::blocking(move || store::write_state(&app, &name, &json)).await?
}

/// Sets an unreadable `var/<name>.json` aside as `<name>.bad.json`.
#[tauri::command]
async fn keep_bad_state(app: tauri::AppHandle, name: String) -> Result<(), String> {
    com::blocking(move || store::keep_bad_state(&app, &name)).await?
}

/// Writes a line to `var/vesta.log` for the frontend (a release build has no console).
#[tauri::command]
async fn log_line(text: String) -> Result<(), String> {
    com::blocking(move || logfile::line(&text)).await
}

#[tauri::command]
async fn get_ui_config(app: tauri::AppHandle) -> Result<config::UiConfigResponse, String> {
    config::ui_config(app).await
}

/// Expands `%NAME%` environment variables (args of execute / link items).
#[tauri::command]
fn expand_env(text: String) -> String {
    location::expand_env(&text)
}

/// Folders and files named on the command line of this (first) instance.
#[tauri::command]
fn startup_paths() -> Vec<String> {
    startup::paths()
}

/// Current placement of the main window, for the frontend to store in the session.
#[tauri::command]
fn window_placement(window: WebviewWindow) -> Result<window_state::Placement, String> {
    window_state::placement(&window)
}

/// Checks GitHub Releases and downloads a newer version; the version ready to apply, or null.
#[tauri::command]
async fn update_check() -> Result<Option<String>, String> {
    com::blocking(update::check_and_download).await?
}

/// Applies the downloaded update and restarts (the process exits).
#[tauri::command]
async fn update_restart() -> Result<(), String> {
    com::blocking(update::restart_now).await?
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
            drop_on_item,
            read_state,
            write_state,
            keep_bad_state,
            log_line,
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

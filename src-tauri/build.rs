fn main() {
    // tauri-build only watches tauri.conf.json and capabilities/, so a new app icon would not
    // reach the exe resources (or the window icon) until something else changed.
    println!("cargo:rerun-if-changed=icons");
    tauri_build::build()
}

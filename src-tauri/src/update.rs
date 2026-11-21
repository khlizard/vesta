//! Self-update with Velopack from GitHub Releases. Spec: docs/spec/update.md
//!
//! The update is downloaded in the background; it is applied either when the user chooses
//! "update and restart" or, failing that, when the app exits.

use std::sync::Mutex;

use velopack::sources::GithubSource;
use velopack::{UpdateCheck, UpdateManager, VelopackApp, VelopackAsset};

/// Where releases are published (`vpk upload github`).
pub const REPO_URL: &str = "https://github.com/khlizard/vesta";

/// A downloaded update waiting to be applied.
static READY: Mutex<Option<(UpdateManager, VelopackAsset)>> = Mutex::new(None);

/// Velopack's install / update / uninstall hooks. Must run first in the process (it may exit).
pub fn startup() {
    VelopackApp::build().run();
}

/// None when the app was not installed by Velopack (e.g. `npm run tauri dev`).
fn manager() -> Option<UpdateManager> {
    UpdateManager::new(GithubSource::new(REPO_URL, None, false), None, None).ok()
}

fn store(um: UpdateManager, asset: VelopackAsset) -> String {
    let version = asset.Version.clone();
    *crate::com::lock(&READY) = Some((um, asset));
    version
}

/// Checks for a newer release and downloads it. Blocking (network).
/// Returns the version that is ready to apply, or None when up to date / not installed.
pub fn check_and_download() -> Result<Option<String>, String> {
    if let Some((_, asset)) = crate::com::lock(&READY).as_ref() {
        return Ok(Some(asset.Version.clone()));
    }
    let Some(um) = manager() else { return Ok(None) };
    // Downloaded earlier but not applied (e.g. the exit-time update did not run).
    if let Some(asset) = um.get_update_pending_restart() {
        return Ok(Some(store(um, asset)));
    }
    match um.check_for_updates().map_err(|e| e.to_string())? {
        UpdateCheck::UpdateAvailable(info) => {
            um.download_updates(&info, None).map_err(|e| e.to_string())?;
            let asset = info.TargetFullRelease.clone();
            Ok(Some(store(um, asset)))
        }
        UpdateCheck::NoUpdateAvailable | UpdateCheck::RemoteIsEmpty => Ok(None),
    }
}

/// Applies the downloaded update and restarts. Exits the process on success.
pub fn restart_now() -> Result<(), String> {
    let ready = crate::com::lock(&READY).take();
    let Some((um, asset)) = ready else {
        return Err("更新はありません".into());
    };
    um.apply_updates_and_restart(&asset).map_err(|e| e.to_string())
}

/// On exit: lets the Velopack updater apply a downloaded update once this process has ended.
pub fn apply_on_exit() {
    let ready = crate::com::lock(&READY).take();
    if let Some((um, asset)) = ready
        && let Err(e) = um.wait_exit_then_apply_updates(&asset, true, false, Vec::<String>::new())
    {
        crate::logfile::line(&format!("update could not be applied on exit: {e}"));
    }
}

//! Creating shortcuts (.lnk) to items.

use std::path::Path;

use windows::Win32::System::Com::{CLSCTX_INPROC_SERVER, CoCreateInstance, IPersistFile};
use windows::Win32::UI::Shell::{IShellLinkW, ShellLink};
use windows::core::{Interface, PCWSTR};

use super::Done;
use super::history::Entry;
use crate::com::{self, err, parsing_name, shell_item, wide};
use crate::types::OpResult;

pub(super) fn link(sources: &[String], dest: &str) -> Result<Done, String> {
    let mut created = Vec::new();
    let mut errors = Vec::new();
    for s in sources {
        match make_link(s, Path::new(dest)) {
            Ok(p) => created.push(p),
            Err(e) => errors.push(format!("{s}: {e}")),
        }
    }
    if created.is_empty() {
        return Err(if errors.is_empty() { "対象がありません".into() } else { errors.join("\n") });
    }
    let entry = Entry::Trash { paths: created.clone(), label: "ショートカットの作成" };
    let aborted = !errors.is_empty();
    Ok((OpResult { created, aborted, done: true, ..Default::default() }, Some(entry)))
}

fn make_link(source: &str, dest_dir: &Path) -> Result<String, String> {
    unsafe {
        let item = shell_item(source).map_err(err)?;
        let target = parsing_name(&item).map_err(err)?;
        let fname = Path::new(&target)
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| com::display_name(&item).unwrap_or_else(|_| "link".into()));
        let base = format!("{fname} - ショートカット");
        let mut path = dest_dir.join(format!("{base}.lnk"));
        let mut n = 2;
        while path.exists() {
            path = dest_dir.join(crate::path::numbered(&base, n, ".lnk"));
            n += 1;
        }
        let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER).map_err(err)?;
        let tw = wide(&target);
        link.SetPath(PCWSTR(tw.as_ptr())).map_err(err)?;
        if let Some(dir) = Path::new(&target).parent().and_then(|d| d.to_str()) {
            let dw = wide(dir);
            let _ = link.SetWorkingDirectory(PCWSTR(dw.as_ptr()));
        }
        let file: IPersistFile = link.cast().map_err(err)?;
        let pw = wide(&path.to_string_lossy());
        file.Save(PCWSTR(pw.as_ptr()), true).map_err(err)?;
        Ok(path.to_string_lossy().into_owned())
    }
}

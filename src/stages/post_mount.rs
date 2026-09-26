use crate::ctx::{self, LOG1, PERSISTENT_DIR};
use crate::fsx;
use crate::text;
use crate::tools::{self, Out};

pub fn run() {
    let post_fs_data = ctx::stage_marker("post_fs_data");

    for l in fsx::lines_without_hash(&format!("{PERSISTENT_DIR}/sus_mount.txt")).unwrap_or_default() {
        let i = text::trim(&l);
        if !i.is_empty() && tools::susfs(&["add_sus_mount", i], Out::Inherit) {
            fsx::append_line(LOG1, &format!("[sus_mount]: nyxsusfs/post-mount {i}"));
        }
    }
    for l in fsx::lines_without_hash(&format!("{PERSISTENT_DIR}/try_umount.txt")).unwrap_or_default() {
        let i = text::trim(&l);
        if !i.is_empty() && tools::susfs(&["add_try_umount", i, "1"], Out::Inherit) {
            fsx::append_line(LOG1, &format!("[try_umount]: nyxsusfs/post-mount {i}"));
        }
    }

    ctx::kernel_log_checkpoint(&post_fs_data, "post_mount");
}

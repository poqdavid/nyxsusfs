use crate::ctx;

pub fn run() {
    let post_fs_data = ctx::stage_marker("post_fs_data");
    ctx::kernel_log_checkpoint(&post_fs_data, "post_mount");
}

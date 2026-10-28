//! 10 分钟摘要调度：每个整 10 分过后 1 分钟跑一次 beayy-summary。
//! 已写过的分段自动跳过，重复跑没有副作用；另用锁文件防止并跑版和正式版同时跑。
//! 读写跟采集同一数据根：`data_root()`（正式版＝Beayy/；测试版 BEAYY_SHADOW=1＝Beayy/shadow/）。

use beayy_core::{data_root, default_root, fields, shadow_mode, EventLog};
use chrono::{Timelike, Utc};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime};

fn lock_path() -> PathBuf {
    data_root().join("summarizer.lock")
}

/// 测试版影子目录里没有 settings／别名时，从正式目录拷一份（密钥仍在钥匙串）
fn ensure_shadow_settings(root: &std::path::Path) {
    if !shadow_mode() {
        return;
    }
    let _ = std::fs::create_dir_all(root);
    for name in ["settings.json", "project_aliases.json"] {
        let src = default_root().join(name);
        let dst = root.join(name);
        if src.is_file() && !dst.is_file() {
            let _ = std::fs::copy(&src, &dst);
        }
    }
}

/// 锁文件里记的进程还在不在（进程被杀时锁文件会留下，10-16 因此停过 20 分钟）
fn holder_alive(p: &std::path::Path) -> bool {
    let Some(pid) = fs::read_to_string(p).ok().and_then(|t| t.trim().parse::<u32>().ok()) else { return true };
    #[cfg(unix)]
    return std::process::Command::new("/bin/kill").args(["-0", &pid.to_string()]).stderr(std::process::Stdio::null()).status().map(|s| s.success()).unwrap_or(true);
    #[cfg(not(unix))]
    return pid > 0;
}

/// 拿锁：文件不存在就建；存在但持锁进程已不在、或超过 15 分钟（上次异常退出），抢过来
fn try_lock() -> bool {
    let p = lock_path();
    if let Ok(meta) = fs::metadata(&p) {
        let old = meta.modified().ok().and_then(|m| SystemTime::now().duration_since(m).ok()).map(|a| a > Duration::from_secs(900)).unwrap_or(true);
        let stale = old || !holder_alive(&p);
        if !stale {
            return false;
        }
        let _ = fs::remove_file(&p);
    }
    OpenOptions::new().write(true).create_new(true).open(&p).map(|mut f| writeln!(f, "{}", std::process::id())).is_ok()
}

pub fn run_once(log: &EventLog) {
    if !try_lock() {
        return;
    }
    let root = data_root();
    ensure_shadow_settings(&root);
    let logs = root.join("logs");
    let _ = fs::create_dir_all(&logs);
    let mut out = OpenOptions::new().create(true).append(true).open(logs.join("summarizer.log")).ok();
    let start = Instant::now();
    let sm = beayy_summary::Summarizer::new(root);
    let mut logline = |line: String| {
        if let Some(f) = out.as_mut() {
            let _ = writeln!(f, "{line}");
        }
    };
    let written = sm.run(&[], &mut logline);
    // 一小时结束、里面的 10 分钟摘要都齐了，就合成小时摘要
    sm.update_aliases(&mut logline);
    sm.rollups(&mut logline);
    log.write("summary.run", fields! {"exit" => 0, "written" => written, "seconds" => start.elapsed().as_secs(), "impl" => "rust"}, None);
    let _ = fs::remove_file(lock_path());
}

/// 每个整 10 分过后 1 分钟（:01、:11……）跑一次
pub fn start(log: Arc<EventLog>, paused: Arc<std::sync::atomic::AtomicBool>) {
    std::thread::spawn(move || loop {
        let now = Utc::now();
        let wait = (60 * (10 - (now.minute() + 9) % 10)) as i64 - now.second() as i64;
        std::thread::sleep(Duration::from_secs(wait.max(30) as u64));
        if !paused.load(std::sync::atomic::Ordering::Relaxed) {
            run_once(&log);
        }
    });
}

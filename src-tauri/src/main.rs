// 时见 TimeSeen · 看见时间，看见自己。 · 人文帮出品。
// 菜单栏标志＋菜单、主窗口（网页四页，app/ui/）、给网页的命令（清单见 COMMANDS.md）、后台定时任务。
// 采集（键鼠、界面文字、在场）在 timeseen-capture 里，由这里启动；macOS 和 Windows 记的事件相同。

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod amap;
mod archive;
mod storage;
mod daily;
mod data;
mod icons;
mod focus;
mod focus_store;
mod mcp;
mod summarizer;
#[cfg(target_os = "macos")]
mod devhook;

use timeseen_core::{data_root, fields, local_device, shadow_mode, EventLog};
use timeseen_phone::PhoneSync;
use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::image::Image;
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};

const PRODUCT: &str = timeseen_core::PRODUCT;
const PHONE_EVERY: Duration = Duration::from_secs(300);
struct AppState {
    log: Arc<EventLog>,
    phone: Mutex<PhoneSync>,
    paused: Arc<AtomicBool>,
    /// 定时暂停到这个时刻自动继续；None＝一直暂停（或没暂停）
    paused_until: Mutex<Option<chrono::DateTime<chrono::Utc>>>,
    /// 今天的条数：(本地日期, 当时数出的文件里条数, 当时 log.count())
    today_base: Mutex<Option<(chrono::NaiveDate, u64, u64)>>,
}

/// 今天本机写了多少条事件：当天第一次问时数一遍今天的分段文件，之后加上本次运行新写的
fn events_today(state: &AppState) -> u64 {
    use chrono::{Local, TimeZone, Utc};
    let today = Local::now().date_naive();
    let mut g = state.today_base.lock().unwrap();
    if g.map(|(d, _, _)| d != today).unwrap_or(true) {
        let start = Local.from_local_datetime(&today.and_hms_opt(0, 0, 0).unwrap()).unwrap().with_timezone(&Utc);
        let first = timeseen_core::segment_key(start);
        let mut n = 0u64;
        if let Ok(it) = std::fs::read_dir(state.log.segments_dir()) {
            for seg in it.filter_map(|e| e.ok()) {
                if seg.file_name().to_string_lossy().as_ref() >= first.as_str() {
                    n += std::fs::read(seg.path().join("events.jsonl")).map(|b| b.iter().filter(|c| **c == b'\n').count() as u64).unwrap_or(0);
                }
            }
        }
        *g = Some((today, n, state.log.count()));
    }
    let (_, base, at) = g.unwrap();
    base + state.log.count().saturating_sub(at)
}

/// 权限查询要查 TCC／起 codesign 子进程，界面切页、开机自检会连着调：缓存 1.5 秒（引导页每 2 秒轮询，授权后最多晚一次）
fn permissions_cached() -> timeseen_capture::PermissionStatus {
    static C: std::sync::Mutex<Option<(std::time::Instant, timeseen_capture::PermissionStatus)>> = std::sync::Mutex::new(None);
    if let Some((t, p)) = C.lock().unwrap().as_ref() {
        if t.elapsed() < Duration::from_millis(1500) {
            return p.clone();
        }
    }
    let p = timeseen_capture::permissions();
    *C.lock().unwrap() = Some((std::time::Instant::now(), p.clone()));
    p
}

// 不在主线程跑：锁被后台同步占着、读文件慢的时候不会把整个窗口卡住
#[tauri::command(async)]
fn get_status(state: tauri::State<'_, Arc<AppState>>) -> Result<Value, String> {
    Ok(json!({
        "permissions": permissions_cached(),
        "capturing": capturing(),
        "paused": state.paused.load(Ordering::Relaxed),
        "paused_until": state.paused_until.lock().unwrap().map(|t| t.to_rfc3339_opts(chrono::SecondsFormat::Secs, true)),
        "events_today": events_today(&state),
        "login_item": login_item(),
        "phone_sync": state.phone.lock().unwrap().last_summary.clone(),
        "device": state.log.device,
        "version": env!("CARGO_PKG_VERSION"),
        "shadow": shadow_mode(),
        "perf": std::env::var("TIMESEEN_PERF").ok(),
    }))
}

fn capturing() -> bool {
    #[cfg(target_os = "macos")]
    return timeseen_capture::macos::capturing();
    #[cfg(target_os = "windows")]
    return timeseen_capture::windows::capturing();
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    return true;
}

/// 暂停／继续。`minutes` 给了就是定时暂停，到点自动继续
#[tauri::command]
fn set_paused(paused: bool, minutes: Option<i64>, state: tauri::State<'_, Arc<AppState>>) {
    *state.paused_until.lock().unwrap() = match (paused, minutes) {
        (true, Some(m)) if m > 0 => Some(chrono::Utc::now() + chrono::Duration::minutes(m)),
        _ => None,
    };
    apply_paused(&state, paused);
}

fn login_item() -> bool {
    #[cfg(target_os = "macos")]
    return timeseen_capture::macos::login_item_enabled();
    #[cfg(not(target_os = "macos"))]
    return false;
}

/// 退出 app（左下角菜单）
#[tauri::command]
fn quit_app(app: AppHandle) {
    app.exit(0);
}

/// 开机自动启动
#[tauri::command]
fn set_login_item(on: bool) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    return timeseen_capture::macos::set_login_item(on);
    #[cfg(not(target_os = "macos"))]
    return if on { Err("这个系统上还不支持".into()) } else { Ok(()) };
}

/// macOS、Windows 上由采集线程发现变化，先把正在打的字落盘再记 app.paused／app.resumed；别的平台这里直接记
fn apply_paused(state: &AppState, paused: bool) {
    if state.paused.swap(paused, Ordering::Relaxed) == paused {
        return;
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    state.log.write(if paused { "app.paused" } else { "app.resumed" }, fields! {}, None);
}

/// 并跑版自检：页面把自己的状态写到影子目录 snapshots/<name>.txt（正式版不响应）
#[tauri::command]
fn dev_report(name: String, text: String) {
    if !shadow_mode() {
        return;
    }
    let name: String = name.chars().filter(|c| !matches!(c, '/' | '\\' | ':')).collect();
    let dir = data_root().join("snapshots");
    let _ = std::fs::create_dir_all(&dir);
    let _ = std::fs::write(dir.join(format!("{name}.txt")), text);
}

#[tauri::command]
fn open_permission(kind: String) {
    // 屏幕使用时间（iCloud 跨设备共享）不是权限，但也在系统设置里：「怎么设置」弹层用
    if kind == "screentime" {
        let _ = std::process::Command::new("/usr/bin/open").arg("x-apple.systempreferences:com.apple.Screen-Time-Settings.extension").spawn();
        return;
    }
    timeseen_capture::open_permission(&kind);
}

/// 「现在读取」：iPhone 屏幕使用时间不等 5 分钟，马上读一次
static PHONE_NOW: AtomicBool = AtomicBool::new(false);

#[tauri::command]
fn phone_read_now() {
    PHONE_NOW.store(true, Ordering::Relaxed);
}

#[tauri::command]
fn open_data_dir() {
    let _ = std::process::Command::new("/usr/bin/open").arg(data_root()).spawn();
}

fn open_main(app: &AppHandle) {
    // 主窗口开着时进 Dock、能 ⌘Tab；关窗隐藏后退回只在菜单栏
    #[cfg(target_os = "macos")]
    let _ = app.set_activation_policy(tauri::ActivationPolicy::Regular);
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.set_focus();
        return;
    }
    let builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
        .title(if shadow_mode() { "时见 测试版" } else { PRODUCT })
        .inner_size(1180.0, 760.0)
        .min_inner_size(760.0, 520.0);
    // 墨线约定：标题栏并进侧栏顶部，系统窗口按钮叠在侧栏左上角（页面让出 72 像素）
    #[cfg(target_os = "macos")]
    let builder = builder.title_bar_style(tauri::TitleBarStyle::Overlay).hidden_title(true);
    let _ = builder.build();
}

fn permission_line() -> String {
    let p = timeseen_capture::permissions();
    let mark = |b: bool| if b { "✓" } else { "✗" };
    format!(
        "辅助功能 {} · 输入监控 {} · 完全磁盘访问 {}",
        mark(p.accessibility),
        mark(p.input_monitoring),
        mark(p.full_disk_access)
    )
}

/// 退出前把正在打的字落盘、记 app.quit。菜单「退出」和系统发来的退出（关机、osascript quit）都走 RunEvent::Exit
fn on_exit(app: &AppHandle) {
    if let Some(s) = app.try_state::<Arc<focus::Service>>() { s.shutdown(); }
    #[cfg(target_os = "macos")]
    timeseen_capture::macos::shutdown();
    #[cfg(target_os = "windows")]
    timeseen_capture::windows::shutdown();
    if let Some(s) = app.try_state::<Arc<AppState>>() {
        s.log.write("app.quit", fields! {}, None);
    }
}

/// 同一个数据目录只跑一个 app：两个一起采会把每条记录写两遍（10-17 更新重启时出过一次）。
/// 测试版写影子目录，锁也在影子目录，照样能和正式版同时开。
/// 更新重启时旧进程可能还没退完，拿不到锁先等一会儿（最多 10 秒），还拿不到才算真有一个在跑。
fn single_instance() -> Result<Option<std::fs::File>, ()> {
    let root = data_root();
    let _ = std::fs::create_dir_all(&root);
    // 锁文件建不了、系统不支持锁：不拦，照常启动（Ok(None)）
    let Ok(f) = std::fs::OpenOptions::new().create(true).truncate(false).write(true).open(root.join("app.lock")) else {
        return Ok(None);
    };
    for _ in 0..40 {
        match f.try_lock() {
            Ok(()) => return Ok(Some(f)),
            Err(std::fs::TryLockError::WouldBlock) => std::thread::sleep(Duration::from_millis(250)),
            Err(_) => return Ok(None),
        }
    }
    Err(())
}

fn main() {
    // 调试用：timeseen --dump list_days｜get_day YYYY-MM-DD｜get_settings｜get_rules，打印命令结果后退出（不启动界面）
    let args: Vec<String> = std::env::args().collect();
    if args.get(1).map(|a| a == "--summarize-once").unwrap_or(false) {
        // 调试用：立刻跑一次 10 分钟摘要调度（同定时任务，含锁文件），完成后退出
        summarizer::run_once(&EventLog::new(data_root(), local_device()));
        return;
    }
    if args.get(1).map(|a| a == "--mcp").unwrap_or(false) {
        // 本机 MCP 服务（标准输入输出），给本机 AI 读记录
        mcp::serve();
        return;
    }
    if args.get(1).map(|a| a == "--daily").unwrap_or(false) {
        // 调试用：写某天的日总结（默认今天）并打印
        let d = args.get(2).and_then(|s| chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d").ok()).unwrap_or_else(|| chrono::Local::now().date_naive());
        match daily::generate(d) {
            Ok(md) => println!("{md}"),
            Err(e) => eprintln!("{e}"),
        }
        return;
    }
    if args.get(1).map(|a| a == "--summary-tag").unwrap_or(false) {
        // 一次性：给还没有「类型＋项目」标签的旧摘要补上，再生成缺的小时摘要
        let sm = timeseen_summary::Summarizer::new(timeseen_core::default_root());
        let n = sm.tag_backfill(|l| println!("{l}"));
        sm.update_aliases(|l| println!("{l}"));
        let m = sm.rollups(|l| println!("{l}"));
        println!("补标签 {n} 段，小时摘要 {m} 段");
        return;
    }
    if args.get(1).map(|a| a == "--summary-redo-idle").unwrap_or(false) {
        // 一次性：已写过的「整段不在电脑前」摘要换成固定版（不调模型）
        let n = timeseen_summary::Summarizer::new(timeseen_core::default_root()).redo_idle();
        println!("换掉 {n} 段");
        return;
    }
    if args.get(1).map(|a| a == "--summary-pack").unwrap_or(false) {
        // 调试用：打印某分段拼好的摘要包（不调模型）
        let sm = timeseen_summary::Summarizer::new(timeseen_core::default_root());
        for name in &args[2..] {
            println!("===== {name} =====\n{}\n", sm.dry_run(name));
        }
        return;
    }
    if let Some(action) = args.get(1).map(String::as_str).filter(|a| matches!(*a, "--export-local" | "--import-local")) {
        let result = args.get(2).ok_or_else(|| "需要本地文件路径".to_string()).and_then(|p| if action=="--export-local" { archive::export_to(std::path::Path::new(p)) } else { archive::import_from(std::path::Path::new(p)) });
        match result { Ok(v)=>println!("{v}"),Err(e)=>{eprintln!("{e}");std::process::exit(1);} } return;
    }
    if args.get(1).map(|a| a == "--dump").unwrap_or(false) {
        let out = match args.get(2).map(String::as_str) {
            Some("list_days") => json!(data::list_days()),
            Some("get_day") => data::get_day(args.get(3).cloned().unwrap_or_default()),
            Some("get_settings") => data::get_settings(),
            Some("get_rules") => data::get_rules(),
            Some("get_todos") => data::get_todos(),
            Some("storage_root") => json!(data_root()),
            Some("list_devices") => json!(data::list_devices()),
            Some("list_projects") => json!(data::list_projects()),
            Some("get_profile") => data::get_profile(),
            Some("permissions") => json!(timeseen_capture::permissions()),
            Some("recent_events") => data::recent_events(args.get(3).cloned().unwrap_or_default(), None, Some(5), None).unwrap_or_else(|e| json!({ "error": e })),
            Some("place_stats") => data::place_stats(None),
            Some("storage_stats") => tauri::async_runtime::block_on(storage::storage_stats()),
            Some("test_model") => json!(tauri::async_runtime::block_on(data::test_model()).map(|_| "通了".to_string()).unwrap_or_else(|e| e)),
            _ => json!({"error": "用法：--dump list_days|get_day 日期|get_settings|get_rules|place_stats"}),
        };
        println!("{}", serde_json::to_string_pretty(&out).unwrap());
        return;
    }
    // 锁要活到进程结束（run 不返回），进程退出时系统自动放掉
    let Ok(_instance) = single_instance() else {
        eprintln!("时见 已经在运行，这个就不开了");
        return;
    };
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            focus::get_focus_state, focus::start_focus, focus::pause_focus, focus::resume_focus, focus::finish_focus,
            focus::get_focus_day, focus::save_focus_settings, focus::save_focus_review, focus::cancel_focus_auto,
            focus::open_focus_mini, focus::close_focus_mini, focus::open_focus_main,
            archive::export_local_data, archive::import_local_data,
            get_status, phone_read_now, set_paused, set_login_item, quit_app, open_permission, open_data_dir, dev_report,
            data::list_days, data::get_day, data::get_rules, data::save_rules, data::get_todos, data::save_todos, data::get_memos, data::save_memos,
            data::get_settings, data::save_settings, storage::storage_stats, data::set_api_key, data::delete_since, data::list_devices, data::rename_device, data::set_place_label, data::recent_events, data::set_place_pick, data::clear_place_pick, data::list_place_labels, data::place_stats, data::edit_place_label, icons::get_icons, daily::generate_daily, daily::save_summary, data::test_model, data::list_models, data::test_models,
            data::get_profile, data::save_profile, data::list_projects, data::merge_project, data::set_project_domain, data::get_plan, data::save_plan, data::get_week, daily::rule_history,
        ])
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let root = data_root();
            let state = Arc::new(AppState { log: Arc::new(EventLog::new(root.clone(), local_device())), phone: Mutex::new(PhoneSync::default()), paused: Arc::new(AtomicBool::new(false)), paused_until: Mutex::new(None), today_base: Mutex::new(None) });
            #[allow(unused_mut)]
            let mut launch = fields! {
                "version" => env!("CARGO_PKG_VERSION"),
                "impl" => "rust",
                "permissions" => timeseen_capture::permissions(),
                "bundle_path" => std::env::current_exe().map(|p| p.display().to_string()).unwrap_or_default(),
                "shadow" => shadow_mode(),
            };
            #[cfg(target_os = "macos")]
            {
                if let Some(b) = timeseen_capture::macos::bundle_path() {
                    launch.insert("bundle_path".into(), json!(b));
                }
                launch.extend(timeseen_capture::macos::launch_fields());
            }
            state.log.write("app.launch", launch, None);
            app.manage(state.clone());
            focus::setup(app.handle());

            // 采集：键鼠、打字与发送、界面文字、切 app、在场（macOS 在主线程调，系统通知要挂在主线程上；Windows 自己起消息线程）
            #[cfg(target_os = "macos")]
            timeseen_capture::macos::start(state.log.clone(), state.paused.clone());
            #[cfg(target_os = "windows")]
            timeseen_capture::windows::start(state.log.clone(), state.paused.clone());

            // 10 分钟摘要：每个整 10 分过后 1 分钟运行 Rust 调度器，锁文件防重入
            summarizer::start(state.log.clone(), state.paused.clone());
            // 日总结：每天 21:30 写当天，次日 0:15 重写前一天
            daily::start(state.paused.clone());
            // 菜单栏：标志模板图（系统按深浅色菜单栏自动反色）＋菜单
            let title = MenuItem::with_id(app, "title", if shadow_mode() { "时见 测试版（数据写影子目录，不算正式记录）".to_string() } else { PRODUCT.into() }, false, None::<&str>)?;
            let open = MenuItem::with_id(app, "open", "打开 时见", true, None::<&str>)?;
            let focus_open = MenuItem::with_id(app, "focus-open", "打开专注时钟", true, None::<&str>)?;
            let focus_toggle = MenuItem::with_id(app, "focus-toggle", "暂停专注", false, None::<&str>)?;
            let perm = MenuItem::with_id(app, "perm", permission_line(), true, None::<&str>)?;
            let tap = MenuItem::with_id(app, "tap", "键鼠监听：启动中", false, None::<&str>)?;
            let phone = MenuItem::with_id(app, "phone", "iPhone：读取中", false, None::<&str>)?;
            let pause = MenuItem::with_id(app, "pause", "暂停记录", true, None::<&str>)?;
            let data = MenuItem::with_id(app, "data", "打开数据目录", true, None::<&str>)?;
            #[cfg(target_os = "macos")]
            let login = CheckMenuItem::with_id(app, "login", "开机自动启动", true, timeseen_capture::macos::login_item_enabled(), None::<&str>)?;
            #[cfg(not(target_os = "macos"))]
            let login = CheckMenuItem::with_id(app, "login", "开机自动启动", false, false, None::<&str>)?;
            let nudge = MenuItem::with_id(app, "nudge", "今天没有要说的", false, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let sep1 = PredefinedMenuItem::separator(app)?;
            let sep2 = PredefinedMenuItem::separator(app)?;
            let sep3 = PredefinedMenuItem::separator(app)?;
            let menu = Menu::with_items(app, &[&title, &nudge, &open, &focus_open, &focus_toggle, &sep1, &perm, &tap, &phone, &sep2, &pause, &data, &login, &sep3, &quit_item])?;
            let icon = Image::from_bytes(include_bytes!("../../Resources/MenuBarIcon@2x.png"))?;
            TrayIconBuilder::with_id("main")
                .icon(icon)
                .icon_as_template(true)
                .tooltip(if shadow_mode() { "时见 测试版" } else { PRODUCT })
                .menu(&menu)
                .show_menu_on_left_click(true)
                .on_menu_event(move |app, e| match e.id.as_ref() {
                    "open" => open_main(app),
                    "focus-open" => focus::open_page(app),
                    "focus-toggle" => focus::tray_toggle(app),
                    "perm" => {
                        let p = timeseen_capture::permissions();
                        let kind = if !p.accessibility {
                            "accessibility"
                        } else if !p.input_monitoring {
                            "input_monitoring"
                        } else {
                            "full_disk_access"
                        };
                        timeseen_capture::open_permission(kind);
                    }
                    "data" => open_data_dir(),
                    "pause" => {
                        if let Some(s) = app.try_state::<Arc<AppState>>() {
                            let p = !s.paused.load(Ordering::Relaxed);
                            *s.paused_until.lock().unwrap() = None;
                            apply_paused(&s, p);
                        }
                    }
                    #[cfg(target_os = "macos")]
                    "login" => {
                        let on = !timeseen_capture::macos::login_item_enabled();
                        if let Err(err) = timeseen_capture::macos::set_login_item(on) {
                            if let Some(s) = app.try_state::<Arc<AppState>>() {
                                s.log.write("login_item.error", fields! {"error" => err}, None);
                            }
                        }
                    }
                    "quit" => app.exit(0),
                    "nudge" => daily::dismiss_shown_nudge(),
                    _ => {}
                })
                .build(app)?;

            // 后台：iPhone 每 5 分钟同步一次（完全磁盘访问刚给上时立刻同步）；菜单上的状态每 5 秒刷新
            let st = state.clone();
            let phone_item = phone.clone();
            let phone_now = Arc::new(AtomicBool::new(false));
            let phone_now2 = phone_now.clone();
            std::thread::spawn(move || loop {
                let notes = st.phone.lock().unwrap().sync(&root);
                for n in notes.iter().filter(|n| n.added > 0) {
                    st.log.write(
                        "phone.sync",
                        fields! {"phone_device" => n.device, "added" => n.added, "total" => n.total, "latest" => n.latest, "source_uuid" => n.uuid},
                        None,
                    );
                }
                let _ = phone_item.set_text(format!("iPhone：{}", st.phone.lock().unwrap().last_summary));
                let mut waited = Duration::ZERO;
                while waited < PHONE_EVERY && !phone_now2.swap(false, Ordering::Relaxed) && !PHONE_NOW.swap(false, Ordering::Relaxed) {
                    std::thread::sleep(Duration::from_secs(1));
                    waited += Duration::from_secs(1);
                }
            });
            let st = state.clone();
            let handle = app.handle().clone();
            let nudge_item = nudge.clone();
            std::thread::spawn(move || {
                let mut fda = timeseen_capture::permissions().full_disk_access;
                let mut nudge_at = std::time::Instant::now() - Duration::from_secs(120);
                loop {
                    let p = timeseen_capture::permissions();
                    if p.full_disk_access && !fda {
                        phone_now.store(true, Ordering::Relaxed);
                    }
                    fda = p.full_disk_access;
                    let _ = perm.set_text(permission_line());
                    let _ = tap.set_text(if capturing() { "键鼠监听：运行中" } else { "键鼠监听：未启动" });
                    // 定时暂停到点：自动继续
                    let due = st.paused_until.lock().unwrap().map(|t| t <= chrono::Utc::now()).unwrap_or(false);
                    if due {
                        *st.paused_until.lock().unwrap() = None;
                        apply_paused(&st, false);
                    }
                    let paused = st.paused.load(Ordering::Relaxed);
                    let _ = pause.set_text(if paused { "继续记录" } else { "暂停记录" });
                    #[cfg(target_os = "macos")]
                    let _ = login.set_checked(timeseen_capture::macos::login_item_enabled());
                    if nudge_at.elapsed() >= Duration::from_secs(60) || daily::NUDGE_DIRTY.swap(false, Ordering::Relaxed) {
                        nudge_at = std::time::Instant::now();
                        match daily::current_nudge() {
                            Some(n) => {
                                let _ = nudge_item.set_enabled(true);
                                let _ = nudge_item.set_text(n.menu);
                            }
                            None => {
                                let _ = nudge_item.set_enabled(false);
                                let _ = nudge_item.set_text("今天没有要说的");
                            }
                        }
                    }
                    if handle.tray_by_id("main").is_some() {
                        let focus_status = focus::tray_text(&handle);
                        let _ = focus_toggle.set_enabled(focus_status.is_some());
                        let _ = focus_toggle.set_text(if focus_status.as_ref().is_some_and(|(_, running)| *running) { "暂停计时" } else { "继续计时" });
                        let _ = focus_open.set_text(focus_status.as_ref().map(|(text, _)| format!("{text} · 打开专注")).unwrap_or_else(|| "打开专注时钟".into()));
                    }
                    std::thread::sleep(Duration::from_secs(5));
                }
            });
            // 并跑版另开自检钩子（见 devhook.rs）
            // 带 --open 启动、或还没做过首次引导：直接打开主窗口
            if std::env::args().any(|a| a == "--open") || data::needs_onboarding() {
                open_main(app.handle());
            }
            #[cfg(target_os = "macos")]
            if shadow_mode() {
                devhook::start(app.handle().clone(), data_root().join("snapshots"), open_main);
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("启动 时见 失败")
        .run(|_app, event| match event {
            RunEvent::Exit => on_exit(_app),
            // 关掉主窗口不退出，菜单栏常驻
            RunEvent::ExitRequested { api, code, .. } if code.is_none() => api.prevent_exit(),
            // 已在运行时再 open 一次（open -a 时见-rs）：打开主窗口
            #[cfg(target_os = "macos")]
            RunEvent::Reopen { .. } => open_main(_app),
            // 点红灯／关主窗口：隐藏到菜单栏，进程不退。真正退出走托盘「退出」或页面 quit_app。
            RunEvent::WindowEvent {
                label,
                event: tauri::WindowEvent::CloseRequested { api, .. },
                ..
            } if label == "main" => {
                api.prevent_close();
                if let Some(w) = _app.get_webview_window("main") {
                    let _ = w.hide();
                }
                #[cfg(target_os = "macos")]
                let _ = _app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            }
            _ => {}
        });
}

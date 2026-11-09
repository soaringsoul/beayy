//! 日总结：app 自己用当天的数据写，不依赖外部脚本。
//! 数字（在电脑前、手机、领域和项目、类型、规矩守没守住）由代码算好填进去；模型只写一句话、做成了什么、偏离、明天。
//! 写到 Beayy/daily/日总结_YYYYMMDD.md。每天 21:30 写当天，次日 0:15 用完整的一天重写一次；页面上也可以随时生成。

use timeseen_core::data_root;
use chrono::{DateTime, Duration, Local, NaiveDate, TimeZone, Timelike, Utc};
use regex::Regex;
use serde_json::{json, Value};
use std::fs;
use std::path::PathBuf;

/// 日总结写在当前数据根下（测试版是影子目录，和总结页读的是同一处）
pub fn path_of(date: NaiveDate) -> PathBuf {
    data_root().join("daily").join(format!("日总结_{}.md", date.format("%Y%m%d")))
}

// ---------- 规矩：和页面上同一套识别规则 ----------

enum Rule {
    /// 几点以后不用：设备 computer／phone／any
    After { dev: &'static str, h: u32, m: u32 },
    /// 某设备每天不超过多少分钟
    Limit { dev: &'static str, minutes: f64 },
    /// 某 app 每天不超过多少分钟
    App { app: String, minutes: f64 },
}

fn parse_rule(text: &str) -> Option<Rule> {
    let t: String = text.split_whitespace().collect();
    let low = t.to_lowercase();
    let dev = if t.contains("电脑") || low.contains("mac") { "computer" } else if t.contains("手机") || low.contains("iphone") { "phone" } else { "any" };
    let after = Regex::new(r"(\d{1,2})(?:[:：点](\d{2})?)?(?:分)?(?:以后|之后|后)").unwrap();
    if let Some(c) = after.captures(&t) {
        if Regex::new(r"不|别|停|关|禁").unwrap().is_match(&t) {
            let mut h: u32 = c[1].parse().ok()?;
            if h < 12 && Regex::new(r"晚上|夜里|夜间|下午|傍晚").unwrap().is_match(&t) {
                h += 12;
            }
            return Some(Rule::After { dev, h, m: c.get(2).and_then(|x| x.as_str().parse().ok()).unwrap_or(0) });
        }
    }
    let lim = Regex::new(r"(?i)(?:不超过|少于|最多|以内|不到|≤|<=?)(\d+(?:\.\d+)?)(小时|h|分钟|min|分)").unwrap();
    if let Some(c) = lim.captures(&t) {
        let n: f64 = c[1].parse().ok()?;
        let minutes = if c[2].contains('小') || c[2].eq_ignore_ascii_case("h") { n * 60.0 } else { n };
        let subject = Regex::new(r"每天|一天|每日|不超过|少于|最多|不到").unwrap().split(&t).next().unwrap_or("").to_string();
        let subject = subject.trim_start_matches(['用', '玩', '刷', '看']).to_string();
        if dev != "any" && Regex::new(r"(?i)^(电脑|手机|mac|iphone)?$").unwrap().is_match(&subject) {
            return Some(Rule::Limit { dev, minutes });
        }
        if !subject.is_empty() {
            return Some(Rule::App { app: subject, minutes });
        }
    }
    None
}

fn secs_after(spans: &[(DateTime<Utc>, DateTime<Utc>)], from: DateTime<Utc>, to: DateTime<Utc>) -> f64 {
    spans.iter().map(|(a, b)| ((*b).min(to) - (*a).max(from)).num_milliseconds().max(0) as f64 / 1000.0).sum()
}

/// 一条规矩今天守没守住：（对照说明，是否守住；None＝还没到点或算不出）
fn check(rule: &str, date: NaiveDate, day: &Value) -> (String, Option<bool>) {
    let Some(r) = parse_rule(rule) else { return ("算不出来，看下面的偏离".into(), None) };
    let live = &day["live"];
    let phone = &day["phone"];
    let iso = |v: &Value| v.as_str().and_then(|s| DateTime::parse_from_rfc3339(s).ok()).map(|t| t.with_timezone(&Utc));
    let start = Local.from_local_datetime(&date.and_hms_opt(0, 0, 0).unwrap()).unwrap().with_timezone(&Utc);
    let end = start + Duration::days(1);
    match r {
        Rule::After { dev, h, m } => {
            let from = start + Duration::minutes((h * 60 + m) as i64);
            if Utc::now() < from {
                return (format!("还没到 {h:02}:{m:02}"), None);
            }
            let mut sec = 0.0;
            if dev != "phone" {
                let spans: Vec<_> = live["spans"].as_array().cloned().unwrap_or_default().iter().filter_map(|x| Some((iso(&x[0])?, iso(&x[1])?))).collect();
                sec += secs_after(&spans, from, end);
            }
            if dev != "computer" {
                for x in phone["sessions"].as_array().cloned().unwrap_or_default() {
                    if let (Some(a), Some(b)) = (iso(&x["start"]), iso(&x["end"])) {
                        let span = (b - a).num_seconds().max(1) as f64;
                        sec += secs_after(&[(a, b)], from, end) / span * x["sec"].as_f64().unwrap_or(0.0);
                    }
                }
            }
            (format!("{h:02}:{m:02} 以后用了 {} 分钟", (sec / 60.0).round()), Some(sec < 60.0))
        }
        Rule::Limit { dev, minutes } => {
            let sec = if dev == "phone" { phone["total_sec"].as_f64().unwrap_or(0.0) } else { live["active_sec"].as_f64().unwrap_or(0.0) };
            (format!("{} {:.1} 小时 / 上限 {:.1} 小时", if dev == "phone" { "手机" } else { "电脑" }, sec / 3600.0, minutes / 60.0), Some(sec <= minutes * 60.0))
        }
        Rule::App { app, minutes } => {
            let key = app.to_lowercase();
            let hit = |x: &Value| x["name"].as_str().unwrap_or("").to_lowercase().contains(&key) || x["bundle_id"].as_str().unwrap_or("").to_lowercase().contains(&key);
            let mut sec = 0.0;
            for s in phone["sessions"].as_array().cloned().unwrap_or_default() {
                for a in s["apps"].as_array().cloned().unwrap_or_default() {
                    if hit(&a) {
                        sec += a["sec"].as_f64().unwrap_or(0.0);
                    }
                }
            }
            for a in live["apps"].as_array().cloned().unwrap_or_default() {
                if hit(&a) {
                    sec += a["sec"].as_f64().unwrap_or(0.0);
                }
            }
            (format!("{app} {} 分钟 / 上限 {} 分钟", (sec / 60.0).round(), minutes), Some(sec <= minutes * 60.0))
        }
    }
}

const PROMPT: &str = "你是用户的日记助手。下面是用户今天的记录：电脑和手机的时长、时间花在哪些领域和项目、每小时在做什么、自己定的规矩今天的对照结果。
据此写今天的日总结，全部用中文，用第二人称「你」，写得具体、平实，不夸、不说教。只写材料里有的事，不编造，不写材料里没有的数字。
只返回一个 JSON 对象，不要代码块，字段：
  line: 今天的一句话，30 字以内，抓住今天最主要的事和状态
  done: 2–5 条字符串，今天做成或推进了什么（写结果，不写过程）
  drift: 0–3 条字符串，偏离：没守住的规矩、熬夜、时间明显被不重要的事占掉；没有就空数组
  tomorrow: 1–3 条字符串，明天最先做的一步。每条大约 25 分钟能开始，尽量点名今天出现过的项目，或从未完成的待办里挑一条；写具体的下一步，不写空话
";

/// 昨天从日总结写成的待办（承诺）：返回 (文字, 是否完成)
fn yesterday_promises(date: NaiveDate) -> Vec<(String, bool)> {
    let y = (date - Duration::days(1)).format("%Y-%m-%d").to_string();
    crate::data::get_todos()
        .as_array()
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter(|t| t["source"].as_str() == Some("daily") && t["from_date"].as_str() == Some(y.as_str()))
        .filter_map(|t| {
            let text = t["text"].as_str()?.to_string();
            if text.is_empty() { None } else { Some((text, t["done"] == true)) }
        })
        .collect()
}

/// 节奏洞察：从当天的在电脑前区间、切换次数、手机拿起算三个读数，让模型能写出「今天切换太碎」这种结论
fn rhythm(day: &Value) -> Vec<(String, String)> {
    let live = &day["live"];
    let phone = &day["phone"];
    let mut out: Vec<(String, String)> = vec![];
    // 最长连续在电脑前
    if let Some(spans) = live["spans"].as_array() {
        let secs = |x: &Value| -> f64 {
            let a = x.get(0).and_then(Value::as_str).and_then(|s| DateTime::parse_from_rfc3339(s).ok());
            let b = x.get(1).and_then(Value::as_str).and_then(|s| DateTime::parse_from_rfc3339(s).ok());
            match (a, b) {
                (Some(a), Some(b)) => (b - a).num_milliseconds() as f64 / 1000.0,
                _ => 0.0,
            }
        };
        if let Some(longest) = spans.iter().map(secs).max_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal)) {
            if longest >= 60.0 {
                out.push(("最长连续在电脑前".into(), dur(longest)));
            }
        }
    }
    // 碎片度：切换次数（在电脑前小时数已知，据此算每小时平均切换）
    if let Some(switches) = live["switches"].as_u64() {
        if switches > 0 {
            let h = live["active_sec"].as_f64().unwrap_or(0.0) / 3600.0;
            let per = if h > 0.5 { (switches as f64 / h).round() as u64 } else { switches };
            out.push(("碎片度".into(), format!("{} 次切换（约 {} 次/小时）", switches, per)));
        }
    }
    // 手机拿起间隔
    if let (Some(pickups), Some(total)) = (phone["pickups"].as_u64(), phone["total_sec"].as_f64()) {
        if pickups > 1 && total > 0.0 {
            out.push(("拿起间隔".into(), format!("平均 {} 分钟一次", (total / (pickups as f64) / 60.0).round() as i64)));
        }
    }
    out
}

fn dur(sec: f64) -> String {
    if sec < 3600.0 {
        format!("{} 分钟", (sec / 60.0).round())
    } else {
        format!("{:.1} 小时", sec / 3600.0)
    }
}

/// 写某天的日总结；返回 Markdown
pub fn generate(date: NaiveDate) -> Result<String, String> {
    // 手动生成和定时生成可能同时启动，避免较早的数据最后覆盖较新的结果。
    static GENERATE_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
    let _guard = GENERATE_LOCK.lock().map_err(|e| format!("日总结任务锁出错：{e}"))?;
    let day = crate::data::get_day(date.format("%Y-%m-%d").to_string());
    let live = &day["live"];
    let phone = &day["phone"];
    let work = &day["work"];
    if live.is_null() && phone.is_null() {
        return Err("这一天没有记录".into());
    }
    // 代码算的数字
    let mut stats = vec![];
    if let Some(sec) = live["active_sec"].as_f64() {
        stats.push(format!("在电脑前 {}（{}–{}），切换 app {} 次", dur(sec), live["first"].as_str().unwrap_or(""), live["last"].as_str().unwrap_or(""), live["switches"]));
    }
    if let Some(sec) = phone["total_sec"].as_f64() {
        let top: Vec<String> = phone["apps"].as_array().cloned().unwrap_or_default().iter().take(3).map(|a| format!("{} {}", a["name"].as_str().unwrap_or(""), dur(a["sec"].as_f64().unwrap_or(0.0)))).collect();
        stats.push(format!("手机 {}，拿起 {} 次{}", dur(sec), phone["pickups"], if top.is_empty() { String::new() } else { format!("，最多的是 {}", top.join("、")) }));
    }
    let tree = |k: &str| -> Vec<String> {
        work[k].as_array().cloned().unwrap_or_default().iter().map(|g| {
            let kids: Vec<String> = g["children"].as_array().cloned().unwrap_or_default().iter().take(4).map(|c| format!("{} {}", c["name"].as_str().unwrap_or(""), dur(c["sec"].as_f64().unwrap_or(0.0)))).collect();
            format!("{} {}（{}）", g["name"].as_str().unwrap_or(""), dur(g["sec"].as_f64().unwrap_or(0.0)), kids.join("、"))
        }).collect()
    };
    let (domains, acts) = (tree("domains"), tree("activities"));
    let rules: Vec<(String, String, Option<bool>)> = crate::data::get_rules()
        .as_array()
        .cloned()
        .unwrap_or_default()
        .iter()
        .filter(|r| r["enabled"] != false)
        .map(|r| {
            let text = r["text"].as_str().unwrap_or("").to_string();
            let (desc, ok) = check(&text, date, &day);
            (text, desc, ok)
        })
        .collect();
    let hours: Vec<String> = day["hours"].as_array().cloned().unwrap_or_default().iter()
        .filter(|h| h["title"] != "不在电脑前")
        .map(|h| {
            let t = h["start"].as_str().and_then(|s| DateTime::parse_from_rfc3339(s).ok()).map(|t| t.with_timezone(&Local).hour()).unwrap_or(0);
            format!("{t:02}:00 {}：{}", h["title"].as_str().unwrap_or(""), h["description"].as_str().unwrap_or(""))
        })
        .collect();
    // 当前这个小时还没有小时摘要：补上最近的 10 分钟摘要
    let recent: Vec<String> = day["segments"].as_array().cloned().unwrap_or_default().iter().rev().take(6)
        .filter(|s| s["kind"] == "10min" && s["source"] == "beayy")
        .map(|s| format!("{} {}：{}", s["start"].as_str().and_then(|x| DateTime::parse_from_rfc3339(x).ok()).map(|t| t.with_timezone(&Local).format("%H:%M").to_string()).unwrap_or_default(), s["title"].as_str().unwrap_or(""), s["description"].as_str().unwrap_or("")))
        .collect();

    let mut user = format!("日期：{}\n\n", date.format("%Y-%m-%d"));
    user += &format!("时长：\n- {}\n\n", stats.join("\n- "));
    let rhythm = rhythm(&day);
    if !rhythm.is_empty() {
        user += &format!("节奏：\n- {}\n\n", rhythm.iter().map(|(k, v)| format!("{}：{}", k, v)).collect::<Vec<_>>().join("\n- "));
    }
    if !domains.is_empty() {
        user += &format!("为了什么（领域、项目）：\n- {}\n\n在做什么（类型）：\n- {}\n\n", domains.join("\n- "), acts.join("\n- "));
    }
    if !rules.is_empty() {
        user += &format!("规矩：\n{}\n\n", rules.iter().map(|(t, d, ok)| format!("- {t}：{d}{}", match ok { Some(true) => "，守住了", Some(false) => "，没守住", None => "" })).collect::<Vec<_>>().join("\n"));
    }
    let open_todos: Vec<String> = crate::data::get_todos()
        .as_array()
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter(|t| t["done"] != true)
        .take(8)
        .map(|t| {
            let q = t["quadrant"].as_i64().unwrap_or(4);
            let name = match q {
                1 => "重要且紧急",
                2 => "重要不紧急",
                3 => "不重要但紧急",
                _ => "不重要不紧急",
            };
            format!("- {}（{name}）", t["text"].as_str().unwrap_or(""))
        })
        .collect();
    user += &format!("未完成的待办：\n{}\n\n", if open_todos.is_empty() { "- 没有".into() } else { open_todos.join("\n") });
    let promises = yesterday_promises(date);
    let promised = promises.iter().filter(|(_, done)| !done).count();
    if !promises.is_empty() {
        user += &format!(
            "昨天承诺的（昨天的日总结写成的待办，{} 条，做成 {} 条，没做成 {} 条）：\n{}\n没做成的，今天有没有推进或就此放下，请写进偏离。\n\n",
            promises.len(),
            promises.iter().filter(|(_, done)| *done).count(),
            promised,
            promises.iter().map(|(text, done)| format!("- {}（{}）", text, if *done { "昨天已做成" } else { "昨天没做成" })).collect::<Vec<_>>().join("\n")
        );
    }
    if day["focus"]["active_sec"].as_f64().unwrap_or(0.0) > 0.0 {
        let notes: Vec<String> = day["focus"]["sessions"].as_array().cloned().unwrap_or_default().iter().take(20)
            .map(|s| format!("- {}：投入 {}；用户回顾：{}", s["task"]["title"].as_str().unwrap_or("自由专注"), dur(s["day_sec"].as_f64().unwrap_or(0.0)), s["note"].as_str().filter(|s| !s.is_empty()).unwrap_or("未填写"))).collect();
        user += &format!("主动专注：{}，完整番茄 {} 段。以下是用户声明的意图和回顾，与电脑活动重叠，不额外相加，不代表任务自动完成。\n{}\n\n", dur(day["focus"]["active_sec"].as_f64().unwrap_or(0.0)), day["focus"]["completed"], notes.join("\n"));
    }
    user += &format!("每小时：\n{}\n\n最近：\n{}\n", hours.join("\n"), recent.join("\n"));
    let sm = timeseen_summary::Summarizer::new(data_root());
    let j = sm.ask_daily(PROMPT, &user).map_err(|e| format!("模型调用失败：{e}"))?;
    let list = |k: &str| -> String {
        let v: Vec<String> = j.get(k).and_then(Value::as_array).cloned().unwrap_or_default().iter().filter_map(|x| x.as_str().map(|s| format!("- {s}"))).collect();
        if v.is_empty() { "- 没有".into() } else { v.join("\n") }
    };
    let weekday = ["日", "一", "二", "三", "四", "五", "六"][date.format("%w").to_string().parse::<usize>().unwrap_or(0)];
    let mut md = format!(
        "# {} 周{weekday}\n\n> 由时见 TimeSeen 用当天的记录生成，数据截至 {}。\n\n## 今天的一句话\n\n{}\n\n## 时间都去哪了\n\n- {}\n",
        date.format("%m-%d"),
        Local::now().format("%m-%d %H:%M"),
        j.get("line").and_then(Value::as_str).unwrap_or("").trim(),
        stats.join("\n- ")
    );
    if !rhythm.is_empty() {
        md += &format!("\n## 节奏\n\n- {}\n", rhythm.iter().map(|(k, v)| format!("{}：{}", k, v)).collect::<Vec<_>>().join("\n- "));
    }
    if !domains.is_empty() {
        md += &format!("\n为了什么：\n\n- {}\n\n在做什么：\n\n- {}\n", domains.join("\n- "), acts.join("\n- "));
    }
    md += &format!("\n## 做成了什么\n\n{}\n", list("done"));
    if !promises.is_empty() {
        let (done_n, undone) = (promises.iter().filter(|(_, done)| *done).count(), promises.iter().filter(|(_, done)| !done).count());
        md += &format!(
            "\n## 昨天承诺的\n\n{} 条，做成 {} 条，没做成 {} 条。\n\n{}\n",
            promises.len(),
            done_n,
            undone,
            promises.iter().map(|(text, done)| format!("- {} {} {}", if *done { "✓" } else { "✗" }, text, if *done { "（昨天已做成）" } else { "" })).collect::<Vec<_>>().join("\n")
        );
    }
    if !rules.is_empty() {
        md += &format!("\n## 规矩\n\n{}\n", rules.iter().map(|(t, d, ok)| format!("- {} {t}：{d}", match ok { Some(true) => "✓", Some(false) => "✗", None => "·" })).collect::<Vec<_>>().join("\n"));
    }
    md += &format!("\n## 偏离\n\n{}\n\n## 明天\n\n{}\n", list("drift"), list("tomorrow"));
    let p = path_of(date);
    fs::create_dir_all(p.parent().unwrap()).map_err(|e| format!("建不了目录 {}：{e}", p.parent().unwrap().display()))?;
    fs::write(&p, &md).map_err(|e| format!("写不进 {}：{e}", p.display()))?;
    Ok(md)
}

/// 页面上「现在生成」
#[cfg_attr(not(timeseen_mobile), tauri::command)]
pub async fn generate_daily(date: String) -> Result<String, String> {
    let d = NaiveDate::parse_from_str(&date, "%Y-%m-%d").map_err(|e| e.to_string())?;
    // 生成要调模型、可能等上几十秒：放到阻塞线程里跑，不占异步线程
    #[cfg(not(timeseen_mobile))]
    { tauri::async_runtime::spawn_blocking(move || generate(d)).await.map_err(|e| format!("生成线程出错：{e}"))? }
    #[cfg(timeseen_mobile)]
    { generate(d) }
}

/// 保存用户手动编辑过的总结（标记为人工修订，下次自动生成不覆盖）
#[cfg_attr(not(timeseen_mobile), tauri::command)]
pub fn save_summary(date: String, text: String) -> Result<(), String> {
    let d = NaiveDate::parse_from_str(&date, "%Y-%m-%d").map_err(|e| e.to_string())?;
    let p = path_of(d);
    fs::create_dir_all(p.parent().unwrap()).map_err(|e| format!("建不了目录 {}：{e}", p.parent().unwrap().display()))?;
    fs::write(&p, &text).map_err(|e| format!("写不进 {}：{e}", p.display()))?;
    Ok(())
}

/// 不存在或在本次定时节点之前写出的总结都需要更新。
fn needs_refresh(path: &std::path::Path, cutoff: chrono::NaiveDateTime) -> bool {
    fs::metadata(path).and_then(|m| m.modified())
        .map(|t| DateTime::<Local>::from(t).naive_local() < cutoff)
        .unwrap_or(true)
}

#[cfg(test)]
mod refresh_tests {
    use super::*;

    #[test]
    fn refreshes_missing_and_pre_cutoff_summaries() {
        let dir = std::env::temp_dir().join(format!("beayy-daily-refresh-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("summary.md");
        assert!(needs_refresh(&path, Local::now().naive_local()));
        fs::write(&path, "summary").unwrap();
        let now = Local::now().naive_local();
        assert!(needs_refresh(&path, now + Duration::minutes(1)));
        assert!(!needs_refresh(&path, now - Duration::minutes(1)));
        fs::remove_dir_all(dir).unwrap();
    }
}

/// 定时：每天 21:30 写当天；次日 0:15 补写或重写前一天。
pub fn start(paused: std::sync::Arc<std::sync::atomic::AtomicBool>) {
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_secs(60));
        if paused.load(std::sync::atomic::Ordering::Relaxed) || crate::data::read_settings_raw().get("ai_enabled").and_then(Value::as_bool) != Some(true) {
            continue;
        }
        let now = Local::now();
        let today = now.date_naive();
        if (now.hour(), now.minute()) >= (21, 30) {
            let cutoff = today.and_hms_opt(21, 30, 0).unwrap();
            if needs_refresh(&path_of(today), cutoff) {
                if let Err(e) = generate(today) { eprintln!("日总结 {} 生成失败：{}", today, e); }
            }
        }
        if (now.hour(), now.minute()) >= (0, 15) {
            let y = today - Duration::days(1);
            let cutoff = today.and_hms_opt(0, 15, 0).unwrap();
            if needs_refresh(&path_of(y), cutoff) {
                if let Err(e) = generate(y) { eprintln!("日总结 {} 生成失败：{}", y, e); }
            }
        }
    });
}

/// 菜单栏点了「知道了」之后，下一轮刷新马上重算
pub static NUDGE_DIRTY: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

pub struct Judged {
    pub mark: &'static str,
    /// 到了八成时给菜单栏的短句，例如「抖音 24/30」
    title: String,
}

fn limit_mark(today: bool, sec: f64, minutes: f64) -> &'static str {
    if sec <= minutes * 60.0 {
        if today && minutes > 0.0 && sec >= minutes * 60.0 * 0.8 { "warn" } else { "ok" }
    } else {
        "miss"
    }
}

fn ratio_title(name: &str, sec: f64, minutes: f64) -> String {
    if minutes >= 60.0 {
        format!("{name} {:.1}/{}", sec / 3600.0, (minutes / 60.0).round() as i64)
    } else {
        format!("{name} {}/{}", (sec / 60.0).round() as i64, minutes.round() as i64)
    }
}

/// 一条规矩在某一天的记号。没有电脑也没有手机记录是 na，不把空白天算成守住。
pub fn judge(rule: &str, date: NaiveDate, live: &Value, phone: &Value) -> Judged {
    let none = Judged { mark: "na", title: String::new() };
    let Some(r) = parse_rule(rule) else { return none };
    if live.is_null() && (phone.is_null() || phone["total_sec"].is_null()) {
        return none;
    }
    let today = Local::now().date_naive() == date;
    let iso = |v: &Value| v.as_str().and_then(|s| DateTime::parse_from_rfc3339(s).ok()).map(|t| t.with_timezone(&Utc));
    let start = Local.from_local_datetime(&date.and_hms_opt(0, 0, 0).unwrap()).unwrap().with_timezone(&Utc);
    let end = start + Duration::days(1);
    match r {
        Rule::After { dev, h, m } => {
            let from = start + Duration::minutes((h * 60 + m) as i64);
            if today && Utc::now() < from {
                return Judged { mark: "open", title: String::new() };
            }
            let mut sec = 0.0;
            if dev != "phone" {
                let spans: Vec<_> = live["spans"].as_array().cloned().unwrap_or_default().iter().filter_map(|x| Some((iso(&x[0])?, iso(&x[1])?))).collect();
                sec += secs_after(&spans, from, end);
            }
            if dev != "computer" {
                for x in phone["sessions"].as_array().cloned().unwrap_or_default() {
                    if let (Some(a), Some(b)) = (iso(&x["start"]), iso(&x["end"])) {
                        let span = (b - a).num_seconds().max(1) as f64;
                        sec += secs_after(&[(a, b)], from, end) / span * x["sec"].as_f64().unwrap_or(0.0);
                    }
                }
            }
            Judged { mark: if sec < 60.0 { "ok" } else { "miss" }, title: String::new() }
        }
        Rule::Limit { dev, minutes } => {
            let sec = if dev == "phone" { phone["total_sec"].as_f64().unwrap_or(0.0) } else { live["active_sec"].as_f64().unwrap_or(0.0) };
            let mark = limit_mark(today, sec, minutes);
            let name = if dev == "phone" { "手机" } else { "电脑" };
            Judged { title: if mark == "warn" { ratio_title(name, sec, minutes) } else { String::new() }, mark }
        }
        Rule::App { app, minutes } => {
            let key = app.to_lowercase();
            let hit = |x: &Value| x["name"].as_str().unwrap_or("").to_lowercase().contains(&key) || x["bundle_id"].as_str().unwrap_or("").to_lowercase().contains(&key);
            let mut sec = 0.0;
            for s in phone["sessions"].as_array().cloned().unwrap_or_default() {
                for a in s["apps"].as_array().cloned().unwrap_or_default() {
                    if hit(&a) {
                        sec += a["sec"].as_f64().unwrap_or(0.0);
                    }
                }
            }
            for a in live["apps"].as_array().cloned().unwrap_or_default() {
                if hit(&a) {
                    sec += a["sec"].as_f64().unwrap_or(0.0);
                }
            }
            let mark = limit_mark(today, sec, minutes);
            Judged { title: if mark == "warn" { ratio_title(&app, sec, minutes) } else { String::new() }, mark }
        }
    }
}

fn day_live(date: NaiveDate) -> (Value, Value) {
    let day = crate::data::get_day(date.format("%Y-%m-%d").to_string());
    let live = crate::data::live_computer(date).unwrap_or_else(|| day["live"].clone());
    (live, day["phone"].clone())
}

/// 最近 N 天每条规矩的记号，旧的在前。给规矩页的 14 天点
#[cfg_attr(not(timeseen_mobile), tauri::command(async))]
pub fn rule_history(days: Option<i64>) -> Value {
    let n = days.unwrap_or(14).clamp(1, 31);
    let today = Local::now().date_naive();
    let rules = crate::data::get_rules().as_array().cloned().unwrap_or_default();
    let mut dates = vec![];
    let mut marks: Vec<Vec<String>> = rules.iter().map(|_| vec![]).collect();
    for i in (0..n).rev() {
        let date = today - Duration::days(i);
        dates.push(date.format("%Y-%m-%d").to_string());
        let (live, phone) = day_live(date);
        for (i, r) in rules.iter().enumerate() {
            let mark = if r["enabled"] == false { "off" } else { judge(r["text"].as_str().unwrap_or(""), date, &live, &phone).mark };
            marks[i].push(mark.into());
        }
    }
    json!({
        "dates": dates,
        "rules": rules.iter().enumerate().map(|(i, r)| json!({"id": r["id"], "marks": marks[i]})).collect::<Vec<_>>(),
    })
}

pub struct Nudge {
    pub key: String,
    pub title: String,
    pub menu: String,
}

/// 菜单栏这一轮要说的一句。一条规矩到了八成只说一次；09:30–11:30 有未完成的昨日承诺时，说这段的名字
pub fn current_nudge() -> Option<Nudge> {
    let now = Local::now();
    let today = now.date_naive();
    let key_day = today.format("%Y-%m-%d").to_string();
    let plan = crate::data::read_plan();
    let dismissed = plan["nudges"][&key_day].as_array().cloned().unwrap_or_default();
    let seen = |k: &str| dismissed.iter().any(|x| x.as_str() == Some(k));
    let (live, phone) = day_live(today);
    for r in crate::data::get_rules().as_array().cloned().unwrap_or_default() {
        if r["enabled"] == false {
            continue;
        }
        let id = r["id"].as_str().unwrap_or("");
        let key = format!("rule:{id}");
        if seen(&key) {
            continue;
        }
        let j = judge(r["text"].as_str().unwrap_or(""), today, &live, &phone);
        if j.mark == "warn" {
            return Some(Nudge { key, menu: format!("{}，到八成。这条今天只说一次", j.title), title: j.title });
        }
    }
    let mins = now.hour() * 60 + now.minute();
    if (9 * 60 + 30..11 * 60 + 30).contains(&mins) && !seen("protect") {
        let y = (today - Duration::days(1)).format("%Y-%m-%d").to_string();
        let text = crate::data::get_todos().as_array().cloned().unwrap_or_default().into_iter().find_map(|t| {
            if t["done"] == true || t["source"] != "daily" || t["from_date"] != y.as_str() {
                return None;
            }
            t["text"].as_str().map(|s| s.chars().take(12).collect::<String>())
        });
        if let Some(text) = text {
            if !text.is_empty() {
                return Some(Nudge { key: "protect".into(), title: format!("09:30 {text}"), menu: format!("09:30–11:30 {text}。知道了就收起") });
            }
        }
    }
    None
}

pub fn dismiss_shown_nudge() {
    if let Some(n) = current_nudge() {
        let _ = crate::data::dismiss_nudge(n.key);
    }
    NUDGE_DIRTY.store(true, std::sync::atomic::Ordering::Relaxed);
}

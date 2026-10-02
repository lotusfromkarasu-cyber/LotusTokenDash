#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use std::{io::{BufRead, BufReader}, process::{Child, Command, Stdio}, sync::{Arc, Mutex, atomic::{AtomicU64, Ordering}}, time::Duration};
use tauri::{Emitter, Manager, PhysicalPosition, LogicalSize, WebviewUrl, WebviewWindowBuilder};
use tauri::menu::{Menu, MenuItem, CheckMenuItem};
use tauri::tray::{TrayIconBuilder, TrayIconEvent, MouseButton, MouseButtonState};
use serde::{Serialize, Deserialize};
mod diagnostics;
mod pointer;

#[derive(Clone, Serialize, Deserialize)]
struct Address { port: u16, token: String }
#[derive(Clone, Serialize, Deserialize)]
struct Layout { mode: String, scale: f64, x: i32, y: i32, #[serde(default="enabled")] topmost: bool }
#[derive(Clone, Serialize)]
struct LayoutSnapshot { #[serde(flatten)] layout:Layout, revision:u64 }
#[derive(Serialize)]
struct DragTicket {revision:u64, #[serde(rename="waitsForRelease")] waits_for_release:bool}
fn enabled() -> bool { true }
impl Default for Layout { fn default() -> Self { Self { mode: "hud".into(), scale: 1.0, x:80, y:80, topmost:true } } }
struct Service {
    address: Arc<Mutex<Option<Result<Address, String>>>>,
    child: Mutex<Option<Child>>,
    layout: Mutex<Layout>,
    details_gate: Arc<Mutex<()>>,
    layout_gate: Arc<Mutex<()>>,
    layout_revision: AtomicU64,
}
#[tauri::command]
fn layout_state(state: tauri::State<'_, Service>) -> LayoutSnapshot {
    LayoutSnapshot {layout:state.layout.lock().unwrap().clone(),revision:state.layout_revision.load(Ordering::SeqCst)}
}
#[tauri::command]
async fn service_address(state: tauri::State<'_, Service>) -> Result<Address, String> {
    for _ in 0..450 {
        if let Some(result) = state.address.lock().map_err(|e| e.to_string())?.clone() { return result; }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    Err("本地统计服务未能启动，请查看应用数据目录中的 service.log".into())
}
fn save_layout(app: &tauri::AppHandle) {
    if diagnostics::enabled() { return; }
    if let Ok(dir) = app.path().app_data_dir() {
        let state = app.state::<Service>();
        if let Ok(layout) = state.layout.lock() {
            let _ = std::fs::write(dir.join("window.json"), serde_json::to_vec(&*layout).unwrap_or_default());
        };
    }
}
fn apply_layout(app: &tauri::AppHandle, mode: String, expanded: bool, scale: f64, revision:u64) -> Result<LayoutSnapshot, String> {
    let window = app.get_webview_window("hud").ok_or("HUD unavailable")?;
    let state = app.state::<Service>();
    // Window getters marshal to the UI thread. Never hold the shared state
    // mutex while calling them: an IPC callback can read that state there.
    let mut layout = state.layout.lock().map_err(|e|e.to_string())?.clone();
    let was_strip = layout.mode == "strip";
    layout.mode = if mode == "strip" { "strip".into() } else { "hud".into() };
    layout.scale = scale.clamp(0.75, 1.5);
    let strip = layout.mode == "strip";
    let (width, height) = if strip && !expanded { (324.0,20.0) } else if !expanded { (324.0,142.0) } else { (324.0,176.0) };
    let old_size = window.outer_size().map_err(|e|e.to_string())?;
    let mut position = window.outer_position().map_err(|e|e.to_string())?;
    let monitor = window.current_monitor().map_err(|e|e.to_string())?;
    let factor = window.scale_factor().map_err(|e|e.to_string())?;
    position.x += ((old_size.width as f64 - width * layout.scale * factor)/2.0).round() as i32;
    if let Some(monitor) = monitor {
        if strip { position.y = monitor.position().y; }
        else if was_strip { position.y = monitor.position().y + (48.0 * factor).round() as i32; }
    }
    window.set_size(LogicalSize::new(width * layout.scale, height * layout.scale)).map_err(|e|e.to_string())?;
    window.set_position(position).map_err(|e|e.to_string())?;
    {
        let mut stored=state.layout.lock().map_err(|e|e.to_string())?;
        stored.mode=layout.mode;stored.scale=layout.scale;stored.x=position.x;stored.y=position.y;
    }
    save_layout(app);
    let snapshot=LayoutSnapshot {layout:state.layout.lock().map_err(|e|e.to_string())?.clone(),revision};
    let _=app.emit("lotus-mode",&snapshot);
    Ok(snapshot)
}
#[tauri::command]
async fn set_layout(app: tauri::AppHandle, mode: String, expanded: bool, scale: f64) -> Result<LayoutSnapshot, String> {
    let state=app.state::<Service>();
    let revision=state.layout_revision.fetch_add(1,Ordering::SeqCst)+1;
    let gate=state.layout_gate.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard=gate.lock().map_err(|e|e.to_string())?;
        let state=app.state::<Service>();
        if revision!=state.layout_revision.load(Ordering::SeqCst) {return Ok(layout_state(state));}
        apply_layout(&app,mode,expanded,scale,revision)
    }).await.map_err(|e|e.to_string())?
}
#[tauri::command]
fn begin_drag(state:tauri::State<'_,Service>) -> DragTicket {
    DragTicket {revision:state.layout_revision.fetch_add(1,Ordering::SeqCst)+1,waits_for_release:cfg!(windows)}
}
#[cfg(windows)]
fn left_button_down() -> bool {
    #[link(name="user32")]
    extern "system" {fn GetAsyncKeyState(key:i32)->i16;}
    // WebView2 can swallow mouseup while the native move loop owns the mouse.
    unsafe {(GetAsyncKeyState(0x01) as u16 & 0x8000)!=0}
}
#[cfg(not(windows))]
fn left_button_down() -> bool {false}
#[tauri::command]
async fn finish_drag(app: tauri::AppHandle, revision:u64) -> Result<LayoutSnapshot, String> {
    while left_button_down() {
        if revision!=app.state::<Service>().layout_revision.load(Ordering::SeqCst) {return Ok(layout_state(app.state::<Service>()));}
        tokio::time::sleep(Duration::from_millis(16)).await;
    }
    let gate=app.state::<Service>().layout_gate.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard=gate.lock().map_err(|e|e.to_string())?;
        if revision!=app.state::<Service>().layout_revision.load(Ordering::SeqCst) {return Ok(layout_state(app.state::<Service>()));}
        finish_drag_layout(&app,revision)
    }).await.map_err(|e|e.to_string())?
}
fn finish_drag_layout(app:&tauri::AppHandle, revision:u64) -> Result<LayoutSnapshot,String> {
    let window = app.get_webview_window("hud").ok_or("HUD unavailable")?;
    let position = window.outer_position().map_err(|e|e.to_string())?;
    let monitor = window.current_monitor().map_err(|e|e.to_string())?;
    let factor = window.scale_factor().map_err(|e|e.to_string())?;
    let state = app.state::<Service>();
    let scale = state.layout.lock().map_err(|e|e.to_string())?.scale;
    let snap = monitor.as_ref().map(|monitor| position.y <= monitor.position().y + (28.0 * factor) as i32).unwrap_or(false);
    let mode = if snap { "strip" } else { "hud" };
    apply_layout(app, mode.into(), false, scale,revision)?;
    if let Some(monitor) = monitor {
        let size = window.outer_size().map_err(|e|e.to_string())?;
        let center = monitor.position().x + (monitor.size().width as i32 - size.width as i32)/2;
        let now = window.outer_position().map_err(|e|e.to_string())?;
        if (now.x - center).abs() < (48.0 * factor) as i32 { let _ = window.set_position(PhysicalPosition::new(center, now.y)); }
    }
    let now = window.outer_position().map_err(|e|e.to_string())?;
    { let mut layout = state.layout.lock().map_err(|e|e.to_string())?; layout.x=now.x; layout.y=now.y; }
    save_layout(app); Ok(layout_state(state))
}
#[tauri::command]
async fn open_details(app: tauri::AppHandle) -> Result<(), String> {
    // WebView2 creation must not run inside a synchronous IPC/tray callback.
    // Serialize the lookup and creation together: simultaneous entry points
    // must reuse the same window, including while its WebView2 is initializing.
    let gate = app.state::<Service>().details_gate.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = gate.lock().map_err(|e|e.to_string())?;
        let testing = diagnostics::enabled();
        if let Some(window) = app.get_webview_window("details") {
            if !testing {
                window.unminimize().map_err(|e|e.to_string())?;
                window.show().map_err(|e|e.to_string())?;
                window.set_focus().map_err(|e|e.to_string())?;
            }
            diagnostics::log(&app,"details reused");
            return Ok(());
        }
        diagnostics::log(&app,"details creating");
        WebviewWindowBuilder::new(&app,"details",WebviewUrl::App("index.html".into()))
            .title("LotusTokenDash · 使用分析").inner_size(1280.0,880.0).min_inner_size(760.0,560.0)
            .visible(!testing).focused(!testing).center().build().map_err(|e|e.to_string())?;
        diagnostics::log(&app,"details created");
        Ok(())
    }).await.map_err(|e|e.to_string())?
}
#[tauri::command]
fn hide_hud(app: tauri::AppHandle) { if let Some(window) = app.get_webview_window("hud") { let _ = window.hide(); } }
#[tauri::command]
fn set_language(app:tauri::AppHandle,language:String) {
    if let Some(window)=app.get_webview_window("details") {
        let _=window.set_title(if language=="zh" {"LotusTokenDash · 使用分析"} else {"LotusTokenDash · Usage analytics"});
    }
}
fn show_hud(app: &tauri::AppHandle) { if let Some(window) = app.get_webview_window("hud") { let _ = window.show(); let _ = window.set_focus(); } }
fn main() {
    let address = Arc::new(Mutex::new(None));
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app,_,_| show_hud(app)))
        .manage(Service { address:address.clone(), child:Mutex::new(None), layout:Mutex::new(Layout::default()), details_gate:Arc::new(Mutex::new(())),layout_gate:Arc::new(Mutex::new(())),layout_revision:AtomicU64::new(0) })
        .invoke_handler(tauri::generate_handler![service_address,layout_state,set_layout,begin_drag,finish_drag,open_details,hide_hud,set_language,diagnostics::renderer_status])
        .on_window_event(|window,event| {
            if window.label()=="details" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close(); let _=window.hide();
                }
            }
        })
        .setup(move |app| {
            let handle = app.handle().clone();
            let data = if diagnostics::enabled() { std::path::PathBuf::from(std::env::var("LOTUS_TEST_DATA_DIR")?) } else { app.path().app_data_dir()? };
            std::fs::create_dir_all(&data)?;
            app.manage(diagnostics::Diagnostics::new(data.clone()));
            diagnostics::log(&handle,concat!("startup v",env!("CARGO_PKG_VERSION")));
            if !diagnostics::enabled() { show_hud(&handle); }
            let script = app.path().resource_dir()?.join("service/desktop.mjs");
            let executable = std::env::current_exe()?.parent().ok_or("Executable directory missing")?.join(if cfg!(windows) {"lotus-node.exe"} else {"lotus-node"});
            let mut command = Command::new(executable); command.arg(script).env("LOTUS_DATA_DIR", &data).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::from(std::fs::File::create(data.join("service.log"))?));
            #[cfg(windows)] { use std::os::windows::process::CommandExt; command.creation_flags(0x08000000); }
            match command.spawn() {
                Ok(mut child) => {
                    let stdout = child.stdout.take().ok_or("Service stdout unavailable")?;
                    *app.state::<Service>().child.lock().unwrap() = Some(child);
                    let ready = address.clone();
                    let service_handle = handle.clone();
                    std::thread::spawn(move || {
                        let mut started=false;
                        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                            if !started {
                                if let Ok(value) = serde_json::from_str::<Address>(&line) {
                                    *ready.lock().unwrap() = Some(Ok(value)); started=true;
                                    diagnostics::log(&service_handle,"service ready");
                                }
                            }
                        }
                        diagnostics::log(&service_handle,"service closed");
                        *ready.lock().unwrap() = Some(Err("本地数据服务启动失败".into()));
                    });
                },
                Err(error) => { *address.lock().unwrap()=Some(Err(error.to_string())); }
            }
            let show = MenuItem::with_id(app,"show","显示 HUD",true,None::<&str>)?;
            let hide = MenuItem::with_id(app,"hide","隐藏 HUD",true,None::<&str>)?;
            let refresh = MenuItem::with_id(app,"refresh","刷新使用量",true,None::<&str>)?;
            let topmost = CheckMenuItem::with_id(app,"topmost","始终置顶",true,true,None::<&str>)?;
            let topmost_check=topmost.clone();
            let details = MenuItem::with_id(app,"details","打开详细分析",true,None::<&str>)?;
            let strip = MenuItem::with_id(app,"strip","顶部吸附细条",true,None::<&str>)?;
            let hud = MenuItem::with_id(app,"hud","悬浮 HUD",true,None::<&str>)?;
            let quit = MenuItem::with_id(app,"quit","退出",true,None::<&str>)?;
            let menu = Menu::with_items(app,&[&show,&hide,&details,&refresh,&strip,&hud,&topmost,&quit])?;
            TrayIconBuilder::new().icon(app.default_window_icon().unwrap().clone()).menu(&menu).show_menu_on_left_click(false)
                .on_menu_event(move |app,event| match event.id.as_ref() {
                    "show" => show_hud(app),
                    "hide" => hide_hud(app.clone()),
                    "refresh" => { let _=app.emit("lotus-refresh",()); },
                    "topmost" => {
                        let checked=topmost_check.is_checked().unwrap_or(true); let _=topmost_check.set_checked(!checked);
                        if let Some(window)=app.get_webview_window("hud") { let _=window.set_always_on_top(!checked); }
                        app.state::<Service>().layout.lock().unwrap().topmost=!checked;save_layout(app);
                    },
                    "details" => { let app=app.clone(); tauri::async_runtime::spawn(async move {
                        if let Err(error)=open_details(app.clone()).await { diagnostics::log(&app,&format!("details failed: {error}")); }
                    }); },
                    "strip" | "hud" => {
                        let mode=event.id.as_ref().to_string(); let scale=app.state::<Service>().layout.lock().unwrap().scale;
                        let handle=app.clone(); tauri::async_runtime::spawn(async move {let _=set_layout(handle,mode,false,scale).await;});show_hud(app);
                    },
                    "quit" => app.exit(0), _=>{}
                })
                .on_tray_icon_event(|tray,event| { if let TrayIconEvent::Click {button:MouseButton::Left,button_state:MouseButtonState::Up,..} = event { show_hud(tray.app_handle()); } }).build(app)?;
            if let Ok(bytes) = std::fs::read(data.join("window.json")) {
                if let Ok(layout) = serde_json::from_slice::<Layout>(&bytes) {
                    let mode=layout.mode.clone(); let scale=layout.scale;
                    if let Some(window)=app.get_webview_window("hud") { let _ = window.set_position(PhysicalPosition::new(layout.x,layout.y)); let _=window.set_always_on_top(layout.topmost); }
                    let _=topmost.set_checked(layout.topmost);
                    *app.state::<Service>().layout.lock().unwrap()=layout;
                    let revision=app.state::<Service>().layout_revision.fetch_add(1,Ordering::SeqCst)+1;
                    let _=apply_layout(&handle,mode,false,scale,revision);
                }
            }
            if diagnostics::enabled() { diagnostics::run(handle); }
            else { pointer::watch(handle); }
            Ok(())
        });
    let app=builder.build(tauri::generate_context!()).expect("Unable to start LotusTokenDash");
    app.run(|app,event| {
        if matches!(event,tauri::RunEvent::Exit) {
            let state=app.state::<Service>();
            if let Some(mut child)=state.child.lock().unwrap().take() { drop(child.stdin.take()); let _=child.wait(); };
        }
    });
}

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use std::{io::{BufRead, BufReader}, process::{Child, Command, Stdio}, sync::{Arc, Mutex}, time::Duration};
use tauri::{Emitter, Manager, PhysicalPosition, LogicalSize, WebviewUrl, WebviewWindowBuilder};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{TrayIconBuilder, TrayIconEvent, MouseButton, MouseButtonState};
use serde::{Serialize, Deserialize};

#[derive(Clone, Serialize, Deserialize)]
struct Address { port: u16, token: String }
#[derive(Clone, Serialize, Deserialize)]
struct Layout { mode: String, scale: f64, x: i32, y: i32 }
impl Default for Layout { fn default() -> Self { Self { mode: "hud".into(), scale: 1.0, x:80, y:80 } } }
struct Service {
    address: Arc<Mutex<Option<Result<Address, String>>>>,
    child: Mutex<Option<Child>>,
    layout: Mutex<Layout>,
}
#[tauri::command]
fn layout_state(state: tauri::State<'_, Service>) -> Layout { state.layout.lock().unwrap().clone() }
#[tauri::command]
async fn service_address(state: tauri::State<'_, Service>) -> Result<Address, String> {
    for _ in 0..450 {
        if let Some(result) = state.address.lock().map_err(|e| e.to_string())?.clone() { return result; }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    Err("本地统计服务未能启动，请查看应用数据目录中的 service.log".into())
}
fn save_layout(app: &tauri::AppHandle) {
    if let Ok(dir) = app.path().app_data_dir() {
        let state = app.state::<Service>();
        if let Ok(layout) = state.layout.lock() {
            let _ = std::fs::write(dir.join("window.json"), serde_json::to_vec(&*layout).unwrap_or_default());
        }
    }
}
#[tauri::command]
fn set_layout(app: tauri::AppHandle, mode: String, expanded: bool, scale: f64) -> Result<(), String> {
    let window = app.get_webview_window("hud").ok_or("HUD unavailable")?;
    let state = app.state::<Service>();
    let mut layout = state.layout.lock().map_err(|e| e.to_string())?;
    let was_strip = layout.mode == "strip";
    layout.mode = if mode == "strip" { "strip".into() } else { "hud".into() };
    layout.scale = scale.clamp(0.75, 1.5);
    let strip = layout.mode == "strip";
    let (width, height) = if strip && !expanded { (260.0,20.0) } else if !expanded { (324.0,142.0) } else { (324.0,176.0) };
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
    layout.x = position.x; layout.y = position.y;
    drop(layout); save_layout(&app);
    Ok(())
}
#[tauri::command]
fn finish_drag(app: tauri::AppHandle) -> Result<(), String> {
    let window = app.get_webview_window("hud").ok_or("HUD unavailable")?;
    let position = window.outer_position().map_err(|e|e.to_string())?;
    let monitor = window.current_monitor().map_err(|e|e.to_string())?;
    let factor = window.scale_factor().map_err(|e|e.to_string())?;
    let state = app.state::<Service>();
    let scale = state.layout.lock().map_err(|e|e.to_string())?.scale;
    let snap = monitor.as_ref().map(|monitor| position.y <= monitor.position().y + (28.0 * factor) as i32).unwrap_or(false);
    let mode = if snap { "strip" } else { "hud" };
    set_layout(app.clone(), mode.into(), false, scale)?;
    if let Some(monitor) = monitor {
        let size = window.outer_size().map_err(|e|e.to_string())?;
        let center = monitor.position().x + (monitor.size().width as i32 - size.width as i32)/2;
        let now = window.outer_position().map_err(|e|e.to_string())?;
        if (now.x - center).abs() < (48.0 * factor) as i32 { let _ = window.set_position(PhysicalPosition::new(center, now.y)); }
    }
    let now = window.outer_position().map_err(|e|e.to_string())?;
    { let mut layout = state.layout.lock().map_err(|e|e.to_string())?; layout.x=now.x; layout.y=now.y; }
    save_layout(&app); let _ = app.emit("lotus-mode", serde_json::json!({"mode":mode})); Ok(())
}
#[tauri::command]
fn open_details(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("details") { let _ = window.show(); return window.set_focus().map_err(|e|e.to_string()); }
    WebviewWindowBuilder::new(&app,"details",WebviewUrl::App("index.html".into()))
        .title("LotusTokenDash · 使用分析").inner_size(1280.0,880.0).min_inner_size(760.0,560.0).center().build().map_err(|e|e.to_string())?;
    Ok(())
}
#[tauri::command]
fn hide_hud(app: tauri::AppHandle) { if let Some(window) = app.get_webview_window("hud") { let _ = window.hide(); } }
fn show_hud(app: &tauri::AppHandle) { if let Some(window) = app.get_webview_window("hud") { let _ = window.show(); let _ = window.set_focus(); } }
fn main() {
    let address = Arc::new(Mutex::new(None));
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app,_,_| show_hud(app)))
        .manage(Service { address:address.clone(), child:Mutex::new(None), layout:Mutex::new(Layout::default()) })
        .invoke_handler(tauri::generate_handler![service_address,layout_state,set_layout,finish_drag,open_details,hide_hud])
        .setup(move |app| {
            let handle = app.handle().clone();
            let data = app.path().app_data_dir()?; std::fs::create_dir_all(&data)?;
            let script = app.path().resource_dir()?.join("service/desktop.mjs");
            let executable = std::env::current_exe()?.parent().ok_or("Executable directory missing")?.join(if cfg!(windows) {"lotus-node.exe"} else {"lotus-node"});
            let mut command = Command::new(executable); command.arg(script).env("LOTUS_DATA_DIR", &data).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::from(std::fs::File::create(data.join("service.log"))?));
            #[cfg(windows)] { use std::os::windows::process::CommandExt; command.creation_flags(0x08000000); }
            match command.spawn() {
                Ok(mut child) => {
                    let stdout = child.stdout.take().ok_or("Service stdout unavailable")?;
                    *app.state::<Service>().child.lock().unwrap() = Some(child);
                    let ready = address.clone();
                    std::thread::spawn(move || {
                        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                            if let Ok(value) = serde_json::from_str::<Address>(&line) { *ready.lock().unwrap() = Some(Ok(value)); return; }
                        }
                        *ready.lock().unwrap() = Some(Err("本地数据服务启动失败".into()));
                    });
                },
                Err(error) => { *address.lock().unwrap()=Some(Err(error.to_string())); }
            }
            let show = MenuItem::with_id(app,"show","显示 HUD",true,None::<&str>)?;
            let details = MenuItem::with_id(app,"details","打开详细分析",true,None::<&str>)?;
            let strip = MenuItem::with_id(app,"strip","顶部吸附细条",true,None::<&str>)?;
            let hud = MenuItem::with_id(app,"hud","悬浮 HUD",true,None::<&str>)?;
            let quit = MenuItem::with_id(app,"quit","退出",true,None::<&str>)?;
            let menu = Menu::with_items(app,&[&show,&details,&strip,&hud,&quit])?;
            TrayIconBuilder::new().icon(app.default_window_icon().unwrap().clone()).menu(&menu).show_menu_on_left_click(false)
                .on_menu_event(|app,event| match event.id.as_ref() {
                    "show" => show_hud(app),
                    "details" => { let _ = open_details(app.clone()); },
                    "strip" | "hud" => {
                        let mode=event.id.as_ref(); let scale=app.state::<Service>().layout.lock().unwrap().scale;
                        let _ = set_layout(app.clone(),mode.into(),false,scale); let _ = app.emit("lotus-mode",serde_json::json!({"mode":mode})); show_hud(app);
                    },
                    "quit" => app.exit(0), _=>{}
                })
                .on_tray_icon_event(|tray,event| { if let TrayIconEvent::Click {button:MouseButton::Left,button_state:MouseButtonState::Up,..} = event { show_hud(tray.app_handle()); } }).build(app)?;
            if let Ok(bytes) = std::fs::read(data.join("window.json")) {
                if let Ok(layout) = serde_json::from_slice::<Layout>(&bytes) {
                    let mode=layout.mode.clone(); let scale=layout.scale;
                    if let Some(window)=app.get_webview_window("hud") { let _ = window.set_position(PhysicalPosition::new(layout.x,layout.y)); }
                    *app.state::<Service>().layout.lock().unwrap()=layout;
                    let _=set_layout(handle.clone(),mode.clone(),false,scale);
                }
            }
            Ok(())
        });
    let app=builder.build(tauri::generate_context!()).expect("Unable to start LotusTokenDash");
    app.run(|app,event| {
        if matches!(event,tauri::RunEvent::Exit) {
            let state=app.state::<Service>();
            if let Some(mut child)=state.child.lock().unwrap().take() { drop(child.stdin.take()); let _=child.wait(); }
        }
    });
}

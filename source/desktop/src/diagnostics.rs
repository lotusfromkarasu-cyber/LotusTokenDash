use std::{collections::HashMap, io::Write, path::PathBuf, sync::Mutex, time::{Duration, SystemTime, UNIX_EPOCH}};
use tauri::Manager;

pub fn enabled() -> bool { std::env::args().any(|arg|arg=="--self-test") }
pub struct Diagnostics { directory:PathBuf, stages:Mutex<HashMap<(String,String),usize>> }
impl Diagnostics {
    pub fn new(directory:PathBuf) -> Self { Self {directory,stages:Mutex::new(HashMap::new())} }
}
pub fn log(app:&tauri::AppHandle,message:&str) {
    let state=app.state::<Diagnostics>();
    if let Ok(mut file)=std::fs::OpenOptions::new().create(true).append(true).open(state.directory.join("desktop.log")) {
        let time=SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs();
        let _=writeln!(file,"{time} {message}");
    }
}
#[tauri::command]
pub fn renderer_status(app:tauri::AppHandle, window:tauri::WebviewWindow, stage:String) {
    // Only lifecycle markers, never API bodies, transcripts or credentials.
    if !["ready","data","failed"].contains(&stage.as_str()) {return;}
    log(&app,&format!("renderer {} {stage}",window.label()));
    *app.state::<Diagnostics>().stages.lock().unwrap().entry((window.label().into(),stage)).or_default()+=1;
}
async fn wait(app:&tauri::AppHandle,label:&str,stage:&str,count:usize) -> Result<(),String> {
    for _ in 0..300 {
        if app.state::<Diagnostics>().stages.lock().unwrap().get(&(label.into(),stage.into())).copied().unwrap_or(0)>=count {return Ok(());}
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    Err(format!("Timed out: {label} {stage} {count}"))
}
pub fn run(app:tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        let result=async {
            wait(&app,"hud","data",1).await?;
            // Exercise the same native IPC used by the HUD, including a burst
            // of simultaneous open requests. All native test windows stay hidden.
            let hud=app.get_webview_window("hud").ok_or("HUD missing")?;
            hud.eval("Promise.all(Array.from({length:8},()=>window.__TAURI_INTERNALS__.invoke('open_details'))).catch(()=>window.__TAURI_INTERNALS__.invoke('renderer_status',{stage:'failed'}))").map_err(|e|e.to_string())?;
            wait(&app,"details","ready",1).await?;
            if app.webview_windows().len()!=2 {return Err("More than one analytics window".into());}
            // Check that analysis API calls and React rendering have completed.
            app.get_webview_window("details").ok_or("Details missing")?.eval("const check=setInterval(()=>{if(document.querySelector('[data-lotus-analysis-ready]')){clearInterval(check);window.__TAURI_INTERNALS__.invoke('renderer_status',{stage:'data'});}},100)").map_err(|e|e.to_string())?;
            wait(&app,"details","data",1).await?;
            for round in 2..=3 {
                app.get_webview_window("details").ok_or("Details missing")?.close().map_err(|e|e.to_string())?;
                super::open_details(app.clone()).await?;
                if app.webview_windows().len()!=2 {return Err("Duplicate analytics window after reopening".into());}
                hud.eval("window.dispatchEvent(new Event('lotus-refresh'))").map_err(|e|e.to_string())?;
                wait(&app,"hud","data",round).await?;
            }
            // A delayed drag completion must never undo a later dock request.
            for _ in 0..3 {
                let revision=super::begin_drag(app.state::<super::Service>());
                super::set_layout(app.clone(),"hud".into(),false,1.0).await?;
                super::set_layout(app.clone(),"strip".into(),false,1.0).await?;
                let result=super::finish_drag(app.clone(),revision).await?;
                if result.layout.mode!="strip" {return Err("Stale drag undid top docking".into());}
            }
            super::set_layout(app.clone(),"hud".into(),false,1.0).await?;
            Ok::<_,String>(())
        }.await;
        let (passed,message)=match result {Ok(())=>(true,"native windows, analysis rendering, 8 concurrent IPC opens, 2 reopen cycles, HUD refresh and 3 stale-drag redock cycles".to_string()),Err(error)=>(false,error)};
        log(&app,&format!("self-test {passed}: {message}"));
        let directory=app.state::<Diagnostics>().directory.clone();
        let _=std::fs::write(directory.join("native-result.json"),serde_json::json!({"passed":passed,"message":message}).to_string());
        app.exit(if passed {0}else{1});
    });
}

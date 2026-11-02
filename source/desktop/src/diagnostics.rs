use std::{collections::HashMap, io::Write, path::PathBuf, sync::Mutex, time::{Duration, SystemTime, UNIX_EPOCH}};
use tauri::{Manager,Emitter};

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
    if !["ready","data","failed","drag-settled","hover-expanded","hover-collapsed"].contains(&stage.as_str()) {return;}
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
                let revision=super::begin_drag(app.state::<super::Service>()).revision;
                super::set_layout(app.clone(),"hud".into(),false,1.0).await?;
                super::set_layout(app.clone(),"strip".into(),false,1.0).await?;
                let result=super::finish_drag(app.clone(),revision).await?;
                if result.layout.mode!="strip" {return Err("Stale drag undid top docking".into());}
            }
            super::set_layout(app.clone(),"hud".into(),false,1.0).await?;
            // Drive the real renderer/IPC drag lifecycle with a blocked move
            // reply, without moving the physical mouse or showing test windows.
            hud.eval("const nativeInvoke=window.__TAURI_INTERNALS__.invoke;window.__TAURI_INTERNALS__.invoke=(command,args)=>command==='plugin:window|start_dragging'?new Promise(()=>{}):nativeInvoke(command,args)").map_err(|e|e.to_string())?;
            for round in 1..=2 {
                super::set_layout(app.clone(),if round==1 {"hud"} else {"strip"}.into(),false,1.0).await?;
                let position=hud.outer_position().map_err(|e|e.to_string())?;
                let monitor=hud.current_monitor().map_err(|e|e.to_string())?.ok_or("Monitor unavailable")?;
                hud.set_position(tauri::PhysicalPosition::new(position.x,monitor.position().y)).map_err(|e|e.to_string())?;
                hud.eval("document.querySelector('.hud').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,buttons:1,pointerId:1}))").map_err(|e|e.to_string())?;
                wait(&app,"hud","drag-settled",round).await?;
                let snapshot=super::layout_state(app.state::<super::Service>());
                if snapshot.layout.mode!="strip" {return Err("Renderer drag did not dock".into());}
                app.emit_to("hud","lotus-hover",serde_json::json!({"inside":true,"revision":snapshot.revision})).map_err(|e|e.to_string())?;
                hud.eval("(()=>{const opening=setInterval(()=>{if(document.querySelector('.hud.docked:not(.thin)')){clearInterval(opening);window.__TAURI_INTERNALS__.invoke('renderer_status',{stage:'hover-expanded'});}},50);})()").map_err(|e|e.to_string())?;
                wait(&app,"hud","hover-expanded",round).await?;
                for _ in 0..100 {
                    if hud.outer_size().map_err(|e|e.to_string())?.height>=100 {break;}
                    tokio::time::sleep(Duration::from_millis(20)).await;
                }
                if hud.outer_size().map_err(|e|e.to_string())?.height<100 {return Err("Hover did not enlarge the native bar window".into());}
                let revision=app.state::<super::Service>().layout_revision.load(std::sync::atomic::Ordering::SeqCst);
                app.emit_to("hud","lotus-hover",serde_json::json!({"inside":false,"revision":revision})).map_err(|e|e.to_string())?;
                hud.eval("(()=>{const closing=setInterval(()=>{if(document.querySelector('.hud.thin')){clearInterval(closing);window.__TAURI_INTERNALS__.invoke('renderer_status',{stage:'hover-collapsed'});}},50);})()").map_err(|e|e.to_string())?;
                wait(&app,"hud","hover-collapsed",3+index*2).await?;
            }
            // Verify all four real native anchors and hover expansion directions.
            // Windows stay hidden; the user's mouse and settings are untouched.
            for (index,edge) in [super::dock::Edge::Top,super::dock::Edge::Bottom,super::dock::Edge::Left,super::dock::Edge::Right].into_iter().enumerate() {
                super::set_layout(app.clone(),"hud".into(),false,1.0).await?;
                let monitor=hud.current_monitor().map_err(|e|e.to_string())?.ok_or("Monitor missing")?;
                let area=monitor.work_area();let size=hud.outer_size().map_err(|e|e.to_string())?;
                let screen=super::dock::Rect{x:area.position.x,y:area.position.y,width:area.size.width as i32,height:area.size.height as i32};
                let centered=super::dock::Rect{x:screen.x+screen.width/2,y:screen.y+screen.height/2,width:size.width as i32,height:size.height as i32};
                let (x,y)=super::dock::anchor(centered,screen,size.width as i32,size.height as i32,edge,0);
                hud.set_position(tauri::PhysicalPosition::new(x,y)).map_err(|e|e.to_string())?;
                let ticket=super::begin_drag(app.state::<super::Service>());
                let snapshot=super::finish_drag(app.clone(),ticket.revision).await?;
                if snapshot.layout.mode!="strip"||snapshot.layout.edge!=edge{return Err(format!("Wrong dock after {edge:?} drag"));}
                let round=index+3;
                let edge_name=serde_json::to_string(&edge).unwrap();
                hud.eval(format!("(()=>{{const check=setInterval(()=>{{if(document.querySelector('.hud.thin[data-edge='+{edge_name}+']')){{clearInterval(check);window.__TAURI_INTERNALS__.invoke('renderer_status',{{stage:'hover-collapsed'}});}}}},50);}})()").as_str()).map_err(|e|e.to_string())?;
                wait(&app,"hud","hover-collapsed",round).await?;
                let revision=app.state::<super::Service>().layout_revision.load(std::sync::atomic::Ordering::SeqCst);
                app.emit_to("hud","lotus-hover",serde_json::json!({"inside":true,"revision":revision})).map_err(|e|e.to_string())?;
                hud.eval("(()=>{const check=setInterval(()=>{if(document.querySelector('.hud.docked:not(.thin)')){clearInterval(check);window.__TAURI_INTERNALS__.invoke('renderer_status',{stage:'hover-expanded'});}},50);})()").map_err(|e|e.to_string())?;
                wait(&app,"hud","hover-expanded",round).await?;
                tokio::time::sleep(Duration::from_millis(150)).await;
                let pos=hud.outer_position().map_err(|e|e.to_string())?;let size=hud.outer_size().map_err(|e|e.to_string())?;
                if pos.x<screen.x||pos.y<screen.y||pos.x+size.width as i32>screen.x+screen.width+1||pos.y+size.height as i32>screen.y+screen.height+1{return Err(format!("Expanded {edge:?} HUD outside work area"));}
                let distance=match edge{super::dock::Edge::Top=>(pos.y-screen.y).abs(),super::dock::Edge::Bottom=>(pos.y+size.height as i32-screen.y-screen.height).abs(),super::dock::Edge::Left=>(pos.x-screen.x).abs(),super::dock::Edge::Right=>(pos.x+size.width as i32-screen.x-screen.width).abs()};
                if distance>1{return Err(format!("Expanded {edge:?} HUD lost its anchor"));}
                let revision=app.state::<super::Service>().layout_revision.load(std::sync::atomic::Ordering::SeqCst);
                app.emit_to("hud","lotus-hover",serde_json::json!({"inside":false,"revision":revision})).map_err(|e|e.to_string())?;
                hud.eval("(()=>{const check=setInterval(()=>{if(document.querySelector('.hud.thin')){clearInterval(check);window.__TAURI_INTERNALS__.invoke('renderer_status',{stage:'hover-collapsed'});}},50);})()").map_err(|e|e.to_string())?;
                wait(&app,"hud","hover-collapsed",4+index*2).await?;
            }
            Ok::<_,String>(())
        }.await;
        let (passed,message)=match result {Ok(())=>(true,"native windows, analysis rendering, unique details, HUD refresh, stale-drag redock, 2 renderer drag/hover recovery cycles and four-edge native drag/expand/collapse anchors".to_string()),Err(error)=>(false,error)};
        log(&app,&format!("self-test {passed}: {message}"));
        let directory=app.state::<Diagnostics>().directory.clone();
        let _=std::fs::write(directory.join("native-result.json"),serde_json::json!({"passed":passed,"message":message}).to_string());
        app.exit(if passed {0}else{1});
    });
}

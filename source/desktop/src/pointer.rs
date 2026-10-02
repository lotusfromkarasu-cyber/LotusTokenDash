// Native window moves can suppress WebView mouseenter/mouseleave on Windows.
// Read only our visible docked window; no global hooks or WebView polling.
#[cfg(windows)]
mod windows {
    use std::{thread,time::Duration};
    use tauri::{Emitter,Manager};
    #[repr(C)] #[derive(Default,Clone,Copy)] struct Point {x:i32,y:i32}
    #[repr(C)] #[derive(Default)] struct Rect {left:i32,top:i32,right:i32,bottom:i32}
    #[link(name="user32")]
    extern "system" {
        fn GetCursorPos(point:*mut Point)->i32;
        fn GetWindowRect(hwnd:isize,rect:*mut Rect)->i32;
        fn IsWindow(hwnd:isize)->i32;
        fn IsWindowVisible(hwnd:isize)->i32;
        fn WindowFromPoint(point:Point)->isize;
        fn GetAncestor(hwnd:isize,flags:u32)->isize;
    }
    pub fn watch(app:tauri::AppHandle) {
        let Some(window)=app.get_webview_window("hud") else {return;};
        let Ok(hwnd)=window.hwnd() else {return;};
        let hwnd=hwnd.0 as isize;
        thread::spawn(move || {
            let mut last=None;
            while unsafe {IsWindow(hwnd)}!=0 {
                thread::sleep(Duration::from_millis(150));
                let state=app.state::<super::super::Service>();
                let strip=state.layout.lock().map(|layout|layout.mode=="strip").unwrap_or(false);
                if !strip||super::super::left_button_down()||unsafe {IsWindowVisible(hwnd)}==0 {last=None;continue;}
                let revision=state.layout_revision.load(std::sync::atomic::Ordering::SeqCst);
                let mut point=Point::default();let mut rect=Rect::default();
                if unsafe {GetCursorPos(&mut point)}==0||unsafe {GetWindowRect(hwnd,&mut rect)}==0 {continue;}
                let inside=point.x>=rect.left&&point.x<rect.right&&point.y>=rect.top&&point.y<rect.bottom
                    &&unsafe {GetAncestor(WindowFromPoint(point),2)}==hwnd;
                if last!=Some((inside,revision)) {
                    last=Some((inside,revision));
                    let _=app.emit_to("hud","lotus-hover",serde_json::json!({"inside":inside,"revision":revision}));
                }
            }
        });
    }
}
#[cfg(windows)] pub use windows::watch;
#[cfg(not(windows))] pub fn watch(_:tauri::AppHandle) {}

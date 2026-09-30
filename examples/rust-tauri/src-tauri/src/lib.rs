pub struct Snapshot {
    pub ready: bool,
}

#[tauri::command]
pub fn snapshot(ready: bool) -> String {
    if ready {
        "ready".to_owned()
    } else {
        "pending".to_owned()
    }
}

pub fn run() {
    tauri::Builder::default().invoke_handler(tauri::generate_handler![snapshot]);
}

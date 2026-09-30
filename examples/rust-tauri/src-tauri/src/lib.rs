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

pub trait Readiness {
    fn ready(&self) -> bool;
}

impl Snapshot {
    pub fn ready(&self) -> bool { self.ready }
}

impl Readiness for Snapshot {
    fn ready(&self) -> bool { self.ready }
}

extern "C" {
    fn external_ready() -> bool;
}
